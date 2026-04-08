# .NET MAUI Blazor Vision Scanner

A .NET MAUI Blazor application for scanning **barcodes**, **MRZ (Machine Readable Zones)**, and **documents** across multiple platforms. Built with the [Dynamsoft Capture Vision SDK](https://www.dynamsoft.com/capture-vision/docs/web/programming/javascript/).

## Supported Platforms

| Platform | Target Framework |
|---|---|
| Android | net8.0-android |
| iOS | net8.0-ios |
| macOS | net8.0-maccatalyst |
| Windows | net8.0-windows10.0.19041.0 |

## Features

### File Reader Mode
- Load any image from the device file system
- **Barcode** — Detects all 1D/2D barcodes and draws a colour-coded overlay directly on the image
- **MRZ** — Reads passport, ID, and visa MRZ lines and parses structured fields (name, nationality, DOB, expiry, etc.)
- **Document** — Detects document boundaries, overlays the detected quad, and opens an interactive quad editor
- EXIF orientation is corrected automatically before processing — rotated camera photos are handled correctly

### Camera Scanner Mode
- Real-time scanning via the device camera
- Camera selection dropdown (defaults to the first available camera)
- **Barcode** — Continuous detection with live result display
- **MRZ** — Continuous detection with a restricted scan region
- **Document** — Detect and capture document boundaries; tap **Capture** to freeze the frame and open the editor

### Document Quad Editor (File & Camera)
- Four draggable corner handles — touch/pointer friendly on both mobile and desktop
- Tap **Rectify** to apply an accurate perspective warp (homography) computed entirely in the browser via Canvas 2D — no server round-trip
- After rectification the corrected image is displayed full-width in the overlay
- Tap **Edit** to return to the quad editor and re-adjust the corners, then re-rectify
- Tap **Save** to export via the native OS share sheet (Android/iOS) or file dialog (Windows/macOS)

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
- [Visual Studio 2022 17.8+](https://visualstudio.microsoft.com/downloads/) with the **.NET MAUI** workload installed

## Getting Started

1. Get a free trial license key from the [Dynamsoft customer portal](https://www.dynamsoft.com/customer/license/trialLicense/?product=dcv&package=cross-platform).

2. Launch the app. Enter your license key on the **Activate SDK** screen and tap **Activate**.

3. Choose **File Reader** or **Camera Scanner**.

### File Reader

1. Select the recognition mode: **Barcode**, **MRZ**, or **Document**.
2. Tap the file picker and select an image.
3. Results appear below the image. For **Document** mode the editor opens automatically — drag the corner handles to refine the boundary, then tap **Rectify**.

### Camera Scanner

1. Grant camera permission when prompted.
2. Select the recognition mode.
3. For **Document** mode, tap **Capture** when the detected boundary looks correct.
4. Adjust the quad handles in the editor, tap **Rectify**, then **Save** to export.

