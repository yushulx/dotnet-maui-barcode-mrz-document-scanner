# .NET MAUI Blazor Vision Scanner
A .NET MAUI Blazor application for scanning **barcodes**, **MRZ (Machine Readable Zones)**, and **documents** across multiple platforms. Built with the [Dynamsoft Capture Vision SDK](https://www.dynamsoft.com/capture-vision/docs/web/programming/javascript/).

## Supported Platforms
- **Windows** (WinUI 3)
- **macOS** (Mac Catalyst)
- **Android**
- **iOS**

## Features
- **Barcode Scanning** — Decode 1D and 2D barcodes from images or live camera
- **MRZ Recognition** — Read passport, ID card, and visa MRZ data with parsed fields (name, nationality, DOB, expiry, etc.)
- **Document Scanning** — Detect document boundaries, rectify perspective, and save the result
- **File Reader** — Load images to decode barcodes, MRZ, or detect documents
- **Camera Scanner** — Real-time scanning via the device camera with camera selection

## Prerequisites

- [.NET 8 SDK](https://dotnet.microsoft.com/en-us/download/dotnet/8.0)
- .NET MAUI workloads:
  ```bash
  dotnet workload install maui
  ```
- [Visual Studio 2022](https://visualstudio.microsoft.com/downloads/) (recommended) or command line


## How to Use

1. Get a trial license from [Dynamsoft Customer Portal](https://www.dynamsoft.com/customer/license/trialLicense/?product=dcv&package=cross-platform).

2. Launch the application and enter your license key on the Home page, then click **Activate**.

3. Navigate to **File Reader** or **Camera Scanner** to start scanning.

4. Select the scan mode: **Barcode**, **MRZ**, or **Document**.

## Build from Command Line

**Android:**
```bash
dotnet build BarcodeScanner/BarcodeScanner.csproj -f net8.0-android
```

**Windows:**
```bash
dotnet build BarcodeScanner/BarcodeScanner.csproj -f net8.0-windows10.0.19041.0
```

**macOS (on Mac):**
```bash
dotnet build BarcodeScanner/BarcodeScanner.csproj -f net8.0-maccatalyst
```

**iOS (on Mac):**
```bash
dotnet build BarcodeScanner/BarcodeScanner.csproj -f net8.0-ios
```

## Camera on macOS

The camera is supported in the WKWebView on macOS through Mac Catalyst. The following configurations make it work:

- **Entitlements**: `com.apple.security.device.camera` is set in `Platforms/MacCatalyst/Entitlements.Debug.plist` and `Entitlements.Release.plist`
- **Info.plist**: `NSCameraUsageDescription` is included in `Platforms/MacCatalyst/Info.plist`
- **WebView configuration**: `AllowsInlineMediaPlayback` and `MediaTypesRequiringUserActionForPlayback` are set in `WebContentPage.xaml.cs`

## Project Structure

```
BarcodeScanner/
├── Pages/
│   ├── Index.razor          # Home page with license activation
│   ├── Reader.razor         # File-based reader (barcode/MRZ/document)
│   └── Scanner.razor        # Camera-based scanner (barcode/MRZ/document)
├── Shared/
│   ├── MainLayout.razor     # App layout with sidebar navigation
│   └── NavMenu.razor        # Navigation menu
├── Platforms/
│   ├── Android/             # Android-specific (camera permissions, WebChromeClient)
│   ├── iOS/                 # iOS-specific (camera permissions)
│   ├── MacCatalyst/         # macOS-specific (entitlements for camera)
│   └── Windows/             # Windows-specific
├── wwwroot/
│   ├── index.html           # Host page with Dynamsoft SDK script
│   ├── jsInterop.js         # JS interop for SDK operations
│   └── full.json            # MRZ recognition configuration
├── WebContentPage.xaml      # BlazorWebView container
└── BarcodeScanner.csproj    # Project file (net8.0 multi-target)
```

## SDK Reference

This project uses [Dynamsoft Capture Vision Bundle v3.2.5000](https://cdn.jsdelivr.net/npm/dynamsoft-capture-vision-bundle@3.2.5000/) which includes:

- **Dynamsoft Barcode Reader** — 1D/2D barcode decoding
- **Dynamsoft Label Recognizer** — MRZ text line recognition
- **Dynamsoft Document Normalizer** — Document boundary detection and perspective correction
- **Dynamsoft Code Parser** — MRZ data parsing
- **Dynamsoft Camera Enhancer** — Camera management for live scanning
