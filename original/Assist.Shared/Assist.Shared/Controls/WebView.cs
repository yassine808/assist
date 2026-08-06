using Assist.Shared.Settings;
using Avalonia.Controls;
using Avalonia.Platform;
using Microsoft.Web.WebView2.Core;
using Microsoft.Web.WebView2.WinForms;
namespace Assist.Shared.Controls;

public class WebView : NativeControlHost
{
    public WebView2? View;
    public CoreWebView2Environment Environment;
    private string cacheLoc = System.IO.Path.Combine(AssistSettings.FolderPath, "Cache", "web");
    protected override IPlatformHandle CreateNativeControlCore(IPlatformHandle parent)
    {
        if (OperatingSystem.IsWindows())
        {
            View = new WebView2();
            
            return new PlatformHandle(View.Handle, "HWND");
        }
        
        return base.CreateNativeControlCore(parent);
    }
    
    protected override void DestroyNativeControlCore(IPlatformHandle control)
    {
        if (OperatingSystem.IsWindows())
        {
            View?.Dispose();
            View = null;
        }

        try
        {
            base.DestroyNativeControlCore(control);
        }
        catch (Exception e)
        {
            return;
        }
    }
    
}