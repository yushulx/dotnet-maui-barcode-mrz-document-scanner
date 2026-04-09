using Microsoft.AspNetCore.Components.WebView.Maui;
using BarcodeScanner.Services;

#if ANDROID
using BarcodeScanner.Platforms.Android;
#endif

namespace BarcodeScanner;

public static class MauiProgram
{

    public static MauiApp CreateMauiApp()
	{
		var builder = MauiApp.CreateBuilder();
		builder
			.UseMauiApp<App>()
			.ConfigureFonts(fonts =>
			{
				fonts.AddFont("OpenSans-Regular.ttf", "OpenSansRegular");
			}).ConfigureMauiHandlers(handlers =>
            {
#if ANDROID
                handlers.AddHandler<BlazorWebView, MauiBlazorWebViewHandler>();
#endif
			});

        builder.Services.AddMauiBlazorWebView();
#if DEBUG
		builder.Services.AddBlazorWebViewDeveloperTools();
#endif

#if MACCATALYST
        builder.Services.AddSingleton<ICameraService, MacCameraService>();
#else
        builder.Services.AddSingleton<ICameraService, DefaultCameraService>();
#endif

		return builder.Build();
	}
}
