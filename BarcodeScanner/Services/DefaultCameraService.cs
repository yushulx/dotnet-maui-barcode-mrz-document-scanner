#if !MACCATALYST
namespace BarcodeScanner.Services;

/// <summary>
/// Default camera service for platforms where the WebView supports getUserMedia directly.
/// No native camera capture is needed on iOS/Android/Windows.
/// </summary>
public class DefaultCameraService : ICameraService
{
    public bool RequiresNativeCamera => false;

    public Task<string[]> GetAvailableCamerasAsync()
    {
        // On platforms with WebView getUserMedia support, no native camera enumeration needed
        return Task.FromResult(Array.Empty<string>());
    }

    public Task OpenCameraAsync(int index)
    {
        // No-op: WebView handles camera directly
        return Task.CompletedTask;
    }

    public Task CloseCameraAsync()
    {
        // No-op: WebView handles camera directly
        return Task.CompletedTask;
    }

    public void SetFrameCallback(Action<string> onFrameReceived)
    {
        // No-op: WebView handles camera directly
    }

    public string? GetLatestFrame() => null;
}
#endif
