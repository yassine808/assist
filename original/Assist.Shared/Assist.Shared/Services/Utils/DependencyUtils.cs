using System;
using System.IO;
using System.Net;
using System.Net.Http;
using System.Threading.Tasks;
using Serilog;

namespace Assist.Shared.Services.Utils;

public class DependencyUtils
{
    private const string CURLDOWNLOADURL = "https://curl.se/windows/dl-8.5.0_3/curl-8.5.0_3-win64-mingw.zip";
    public static readonly string DependencyPath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AssistData", "Deps");
    public static readonly string CurlDependencyFolder = Path.Combine(DependencyPath, "curl");
    private static readonly HttpClient DownloadClient = new HttpClient();
    public static async Task<bool> CheckDepends()
    {
        if (!OperatingSystem.IsWindows())
            return true;
        
        Log.Information("Checking for Dependencies");
        Directory.CreateDirectory(DependencyPath);
        var curlFile= File.Exists(Path.Combine(CurlDependencyFolder, "curl.exe"));

        if (!curlFile)
        {
            var successful = await DownloadCurlDepend();
            if (!successful)
            {
                Log.Error("Failed to Download Curl Dependency");
            }
        }

        return true;

    }


    /// <summary>
    /// Handles the Downloading of Curl
    /// </summary>
    private static async Task<bool> DownloadCurlDepend()
    {
        try
        {
            Directory.CreateDirectory(CurlDependencyFolder);
            var zipName = "curl.temp.zip";
            var zipPath = Path.Combine(CurlDependencyFolder, zipName);
            var extractionFolder = Path.Combine(CurlDependencyFolder, "temp");
        
            Directory.CreateDirectory(extractionFolder);
            var stream = await GetFileStream(CURLDOWNLOADURL);
        
            using (FileStream outputFileStream = new FileStream(zipPath, FileMode.Create))
            {
                await stream.CopyToAsync(outputFileStream);
            }
            
            System.IO.Compression.ZipFile.ExtractToDirectory(zipPath, extractionFolder, true);
            var files = Directory.GetFiles(extractionFolder ,"*.exe", SearchOption.AllDirectories);
            foreach (var file in files)
            {
                Log.Information("Curl Directory File: " + file);
            }

            if (files.Length == 1)
            {
                var folder = Path.GetDirectoryName(files[0]);
                foreach (var filePath in Directory.GetFiles(folder))
                {
                    var fileName = Path.GetFileName(filePath);
                    File.Copy(filePath, Path.Combine(CurlDependencyFolder, fileName), true);
                }
            }
            
            Directory.Delete(extractionFolder, true); // Remove Temp files
            File.Delete(zipPath); // Remove Temp files
        }
        catch (Exception e)
        {
            Log.Error("Failed to Download Curl Depen");
            Log.Error("Error Message: " + e.Message);
            return false;
        }
        return true;
    }
    
    async static Task<Stream> GetFileStream(string fileUrl)
    {
        
        try
        {
            Stream fileStream = await DownloadClient.GetStreamAsync(fileUrl);
            return fileStream;
        }
        catch (Exception ex)
        {
            return Stream.Null;
        }
    }

}