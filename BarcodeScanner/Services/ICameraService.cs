namespace BarcodeScanner.Services;

/// <summary>
/// Interface for platform-specific camera services.
/// On MacCatalyst, this uses AVFoundation to capture frames and sends them to the WebView.
/// On other platforms, the WebView handles camera access directly via getUserMedia.
/// </summary>
public interface ICameraService
{
    /// <summary>
    /// Whether this platform requires native camera capture (vs WebView getUserMedia).
    /// Returns true on MacCatalyst where WKWebView doesn't support getUserMedia.
    /// </summary>
    bool RequiresNativeCamera { get; }

    /// <summary>
    /// Get available camera device names.
    /// </summary>
    Task<string[]> GetAvailableCamerasAsync();

    /// <summary>
    /// Open the camera at the specified index and start capturing frames.
    /// </summary>
    Task OpenCameraAsync(int index);

    /// <summary>
    /// Close the camera and stop capturing.
    /// </summary>
    Task CloseCameraAsync();

    /// <summary>
    /// Set the callback that receives base64-encoded JPEG frames.
    /// </summary>
    void SetFrameCallback(Action<string> onFrameReceived);

    /// <summary>
    /// Returns the most recently captured frame as a base64 JPEG data URL,
    /// or null if no frame has been captured yet.
    /// Used by the JS polling timer instead of push callbacks.
    /// </summary>
    string? GetLatestFrame();
}
