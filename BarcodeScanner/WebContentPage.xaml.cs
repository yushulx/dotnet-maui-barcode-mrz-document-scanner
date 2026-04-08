using Microsoft.AspNetCore.Components.WebView;

#if ANDROID
using BarcodeScanner.Platforms.Android;
#endif

namespace BarcodeScanner;

public partial class WebContentPage : ContentPage
{
	public WebContentPage()
	{
		InitializeComponent();
        webView.BlazorWebViewInitializing += WebView_BlazorWebViewInitializing;
    }

    private void WebView_BlazorWebViewInitializing(object sender, BlazorWebViewInitializingEventArgs e)
    {
#if IOS || MACCATALYST                   
            e.Configuration.AllowsInlineMediaPlayback = true;
            e.Configuration.MediaTypesRequiringUserActionForPlayback = WebKit.WKAudiovisualMediaTypes.None;
#endif
    }
}