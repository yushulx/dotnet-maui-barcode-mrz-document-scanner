#if MACCATALYST
using AVFoundation;
using CoreFoundation;
using CoreGraphics;
using CoreMedia;
using CoreVideo;
using Foundation;
using UIKit;

namespace BarcodeScanner.Services;

/// <summary>
/// MacCatalyst camera service using AVFoundation.
/// Captures video frames via AVCaptureVideoDataOutput and sends them as base64 JPEG
/// to the WebView for rendering in an &lt;img&gt; element and barcode/MRZ decoding.
/// 
/// This is needed because WKWebView on MacCatalyst does not support getUserMedia.
/// The approach:
///   1. C# opens the camera via AVFoundation AVCaptureSession
///   2. Frames are captured via AVCaptureVideoDataOutput (raw pixel buffers)
///   3. Each frame is converted to JPEG, base64-encoded, and sent to JS
///   4. JS sets the &lt;img&gt; src for preview and calls cvr.capture() for decoding
///      (same as the file-decode path, not the live-stream path)
/// </summary>
public class MacCameraService : ICameraService
{
    private AVCaptureSession? _captureSession;
    private AVCaptureDevice? _captureDevice;
    private AVCaptureDeviceInput? _captureInput;
    private AVCaptureVideoDataOutput? _videoOutput;
    private FrameSampleBufferDelegate? _sampleBufferDelegate;
    private DispatchQueue _captureQueue = new DispatchQueue("camera_capture_queue");
    private DispatchQueue _sessionQueue = new DispatchQueue("camera_session_queue");
    private Action<string>? _onFrameReceived;
    private bool _isRunning;
    private int _frameCounter;
    private const int FrameInterval = 2; // Process every 2nd frame

    // Latest captured frame stored here so JS polling timer can retrieve it
    private volatile string? _latestFrame;
    // Explicit strong ref to prevent GC of delegate before session stops
    private FrameSampleBufferDelegate? _delegateRef;

    public bool RequiresNativeCamera => true;

    public async Task<string[]> GetAvailableCamerasAsync()
    {
        var status = AVCaptureDevice.GetAuthorizationStatus(AVAuthorizationMediaType.Video);
        if (status != AVAuthorizationStatus.Authorized)
        {
            var tcs = new TaskCompletionSource<bool>();
            AVCaptureDevice.RequestAccessForMediaType(AVAuthorizationMediaType.Video, granted =>
            {
                tcs.TrySetResult(granted);
            });
            if (!await tcs.Task)
            {
                return Array.Empty<string>();
            }
        }

        var discoverySession = AVCaptureDeviceDiscoverySession.Create(
            new[] { AVCaptureDeviceType.BuiltInWideAngleCamera },
            AVMediaTypes.Video,
            AVCaptureDevicePosition.Unspecified);

        var cameras = discoverySession.Devices?
            .Select(d => d.LocalizedName ?? "Camera")
            .ToArray() ?? Array.Empty<string>();

        return cameras;
    }

    public async Task OpenCameraAsync(int index)
    {
        // Request permission before touching AVCaptureSession
        var status = AVCaptureDevice.GetAuthorizationStatus(AVAuthorizationMediaType.Video);
        if (status != AVAuthorizationStatus.Authorized)
        {
            var tcs = new TaskCompletionSource<bool>();
            AVCaptureDevice.RequestAccessForMediaType(AVAuthorizationMediaType.Video, granted =>
            {
                tcs.SetResult(granted);
            });
            if (!await tcs.Task)
            {
                Console.Error.WriteLine("Camera permission denied");
                return;
            }
        }

        // IMPORTANT: configure session and call StartRunning on a background serial queue.
        // StartRunning() is synchronous and blocks the calling thread; it must NOT run on
        // the main thread or it will freeze the UI / cause a deadlock on macOS.
        var sessionTcs = new TaskCompletionSource<bool>();
        _sessionQueue.DispatchAsync(() =>
        {
            try
            {
                // Try discovery session first; on Mac Catalyst the FaceTime HD camera
                // is typically BuiltInWideAngleCamera at Front position.
                var discoverySession = AVCaptureDeviceDiscoverySession.Create(
                    new[] { AVCaptureDeviceType.BuiltInWideAngleCamera },
                    AVMediaTypes.Video,
                    AVCaptureDevicePosition.Unspecified);

                var devices = discoverySession.Devices ?? Array.Empty<AVCaptureDevice>();
                Console.WriteLine($"MacCameraService: Discovery found {devices.Length} device(s)");

                // Fallback: use the system-default video device (catches FaceTime HD / external cams)
                AVCaptureDevice? selectedDevice = null;
                if (devices.Length > 0)
                {
                    selectedDevice = index < devices.Length ? devices[index] : devices[0];
                }
                else
                {
                    selectedDevice = AVCaptureDevice.GetDefaultDevice(AVMediaTypes.Video);
                    Console.WriteLine($"MacCameraService: Fallback to default device: {selectedDevice?.LocalizedName ?? "NULL"}");
                }

                if (selectedDevice == null)
                {
                    // Store diagnostic as a red pixel so JS sees "something"
                    _latestFrame = "data:text/plain,NO_DEVICE";
                    Console.Error.WriteLine("MacCameraService: No camera device available");
                    sessionTcs.TrySetResult(false);
                    return;
                }

                Console.WriteLine($"MacCameraService: Selected camera: {selectedDevice.LocalizedName}");

                StopSession();
                _captureDevice = selectedDevice;

                _captureSession = new AVCaptureSession();
                // Use medium quality preset — high may be unsupported on some Macs
                if (_captureSession.CanSetSessionPreset(AVCaptureSession.Preset640x480))
                    _captureSession.SessionPreset = AVCaptureSession.Preset640x480;
                else if (_captureSession.CanSetSessionPreset(AVCaptureSession.PresetMedium))
                    _captureSession.SessionPreset = AVCaptureSession.PresetMedium;

                NSError? inputError;
                _captureInput = AVCaptureDeviceInput.FromDevice(_captureDevice, out inputError);
                if (inputError != null || _captureInput == null)
                {
                    Console.Error.WriteLine($"MacCameraService: Input error: {inputError?.LocalizedDescription ?? "null input"}");
                    sessionTcs.TrySetResult(false);
                    return;
                }
                if (!_captureSession.CanAddInput(_captureInput))
                {
                    Console.Error.WriteLine("MacCameraService: Cannot add camera input");
                    sessionTcs.TrySetResult(false);
                    return;
                }
                _captureSession.AddInput(_captureInput);

                _videoOutput = new AVCaptureVideoDataOutput { AlwaysDiscardsLateVideoFrames = true };
                // Must pass NSNumber for the pixel format type value
                _videoOutput.WeakVideoSettings = new NSDictionary(
                    CVPixelBuffer.PixelFormatTypeKey,
                    NSNumber.FromInt32((int)CVPixelFormatType.CV32BGRA));

                // Keep explicit strong ref so GC doesn't collect the delegate while session runs
                _delegateRef = new FrameSampleBufferDelegate(this);
                _sampleBufferDelegate = _delegateRef;
                _videoOutput.SetSampleBufferDelegate(_sampleBufferDelegate, _captureQueue);
                Console.WriteLine($"MacCameraService: Sample buffer delegate set: {_videoOutput.SampleBufferDelegate != null}");

                if (!_captureSession.CanAddOutput(_videoOutput))
                {
                    Console.Error.WriteLine("MacCameraService: Cannot add video output");
                    sessionTcs.TrySetResult(false);
                    return;
                }
                _captureSession.AddOutput(_videoOutput);
                Console.WriteLine($"MacCameraService: Output added, connections: {_videoOutput.Connections?.Length ?? 0}");

                _frameCounter = 0;
                Console.WriteLine("MacCameraService: Calling StartRunning...");
                _captureSession.StartRunning();
                _isRunning = _captureSession.Running;
                Console.WriteLine($"MacCameraService: Session.Running = {_isRunning}");

                // Write a diagnostic marker so JS knows C# session-setup ran
                _latestFrame = $"data:text/plain,SESSION_STARTED_RUNNING={_isRunning}";

                sessionTcs.TrySetResult(_isRunning);
            }
            catch (Exception ex)
            {
                Console.Error.WriteLine($"MacCameraService: OpenCamera error: {ex.Message}\n{ex.StackTrace}");
                sessionTcs.TrySetResult(false);
            }
        });

        var result = await sessionTcs.Task;
        Console.WriteLine($"MacCameraService: OpenCameraAsync completed with result: {result}");
    }

    public async Task CloseCameraAsync()
    {
        var tcs = new TaskCompletionSource<bool>();
        _sessionQueue.DispatchAsync(() =>
        {
            StopSession();
            tcs.TrySetResult(true);
        });
        await tcs.Task;
    }

    public void SetFrameCallback(Action<string> onFrameReceived)
    {
        _onFrameReceived = onFrameReceived;
    }

    public string? GetLatestFrame() => _latestFrame;

    private void ProcessSampleBuffer(CMSampleBuffer sampleBuffer)
    {
        if (!_isRunning) 
        {
            sampleBuffer.Dispose();
            return;
        }

        _frameCounter++;
        // Log first raw buffer arrival as a diagnostic marker visible via JS polling
        if (_frameCounter == 1)
        {
            _latestFrame = "data:text/plain,FIRST_FRAME_RAW_ARRIVED";
        }

        if (_frameCounter % FrameInterval != 0)
        {
            sampleBuffer.Dispose();
            return;
        }

        try
        {
            using var imageBuffer = sampleBuffer.GetImageBuffer();
            if (imageBuffer is not CVPixelBuffer pixelBuffer)
            {
                _latestFrame = "data:text/plain,ERR_NOT_PIXEL_BUFFER";
                sampleBuffer.Dispose();
                return;
            }

            // Lock pixel buffer for reading
            var lockFlags = CVPixelBufferLock.ReadOnly;
            var lockResult = pixelBuffer.Lock(lockFlags);
            if (lockResult != CVReturn.Success)
            {
                _latestFrame = $"data:text/plain,ERR_LOCK_FAILED_{lockResult}";
                sampleBuffer.Dispose();
                return;
            }

            nint width = pixelBuffer.Width;
            nint height = pixelBuffer.Height;
            nint bytesPerRow = pixelBuffer.BytesPerRow;
            IntPtr baseAddress = pixelBuffer.BaseAddress;

            if (baseAddress == IntPtr.Zero || width == 0 || height == 0)
            {
                pixelBuffer.Unlock(lockFlags);
                _latestFrame = $"data:text/plain,ERR_BAD_BUFFER_w{width}xh{height}";
                sampleBuffer.Dispose();
                return;
            }

            // Build CGImage from the locked pixel buffer data.
            // Copy the pixel data into a managed CGDataProvider so the CGBitmapContext
            // doesn't hold a reference to the raw AVFoundation memory after unlock.
            var dataLength = bytesPerRow * height;
            var pixelData = new byte[dataLength];
            System.Runtime.InteropServices.Marshal.Copy(baseAddress, pixelData, 0, (int)dataLength);

            pixelBuffer.Unlock(lockFlags);

            using var colorSpace = CGColorSpace.CreateDeviceRGB();
            using var provider = new CoreGraphics.CGDataProvider(pixelData);
            using var cgImage = new CoreGraphics.CGImage(
                (int)width, (int)height,
                8,                          // bits per component
                32,                         // bits per pixel
                (int)bytesPerRow,
                colorSpace,
                CGBitmapFlags.ByteOrder32Little | (CGBitmapFlags)CGImageAlphaInfo.PremultipliedFirst,
                provider,
                null,
                false,
                CGColorRenderingIntent.Default);

            if (cgImage == null)
            {
                _latestFrame = "data:text/plain,ERR_CGIMAGE_NULL";
                sampleBuffer.Dispose();
                return;
            }

            // Encode as JPEG via UIImage without scaling for first few frames to avoid failures
            using var uiImage = new UIImage(cgImage);
            var jpegData = uiImage.AsJPEG(0.7f);
            if (jpegData == null || jpegData.Length == 0)
            {
                _latestFrame = "data:text/plain,ERR_JPEG_NULL";
                sampleBuffer.Dispose();
                return;
            }

            var base64 = jpegData.GetBase64EncodedString(NSDataBase64EncodingOptions.None);
            var dataUrl = "data:image/jpeg;base64," + base64;
            jpegData.Dispose();

            _latestFrame = dataUrl;
            _onFrameReceived?.Invoke(dataUrl);
        }
        catch (Exception ex)
        {
            _latestFrame = $"data:text/plain,EX_{Uri.EscapeDataString(ex.GetType().Name + ":" + ex.Message.Replace(",","_").Substring(0, Math.Min(80, ex.Message.Length)))}";
            Console.Error.WriteLine($"ProcessSampleBuffer error: {ex.Message}");
        }
        finally
        {
            sampleBuffer.Dispose();
        }
    }

    private void StopSession()
    {
        _isRunning = false;

        // Clear delegate immediately to stop frame callbacks before tearing down the session
        _videoOutput?.SetSampleBufferDelegate(null, null);

        if (_captureSession != null)
        {
            if (_captureSession.Running)
                _captureSession.StopRunning();

            if (_captureInput != null)
            {
                _captureSession.RemoveInput(_captureInput);
                _captureInput.Dispose();
                _captureInput = null;
            }

            if (_videoOutput != null)
            {
                _captureSession.RemoveOutput(_videoOutput);
                _videoOutput.Dispose();
                _videoOutput = null;
            }

            _sampleBufferDelegate = null;
            _delegateRef = null;

            _captureSession.Dispose();
            _captureSession = null;
        }

        _captureDevice = null;
    }

    private class FrameSampleBufferDelegate : AVCaptureVideoDataOutputSampleBufferDelegate
    {
        private readonly MacCameraService _service;

        public FrameSampleBufferDelegate(MacCameraService service)
        {
            _service = service;
        }

        public override void DidOutputSampleBuffer(AVCaptureOutput captureOutput, CMSampleBuffer sampleBuffer, AVCaptureConnection connection)
        {
            _service.ProcessSampleBuffer(sampleBuffer);
        }
    }
}
#endif
