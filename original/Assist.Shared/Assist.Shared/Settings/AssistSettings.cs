using System;
using System.IO;
using System.Text;
using System.Text.Json;
using System.Xml;
using Assist.Core.Settings.Options;
using Assist.Models.Enums;
using Assist.Shared.Services.Utils;
using Assist.ViewModels;
using CommunityToolkit.Mvvm.ComponentModel;
using Serilog;

namespace Assist.Shared.Settings;

public sealed partial class AssistSettings : ViewModelBase
{
    public static AssistSettings Default { get; set; }

    public static readonly string FolderPath =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AssistData");
    public static readonly string CacheFolderPath =
        Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AssistData", "Images", "Cache" );

#if DEBUG
    public static readonly string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AssistData", "AssistSettings_Debug.json");
#else
        public static readonly string FilePath = Path.Combine(Environment.GetFolderPath(Environment.SpecialFolder.ApplicationData), "AssistData", "AssistSettings.json");
#endif
    
    static AssistSettings()
    {
        Default = new AssistSettings();
    }
    
    public static void Save()
    {
        if (Default == null) return;
        File.WriteAllText(FilePath, JsonSerializer.Serialize(Default, new JsonSerializerOptions() { WriteIndented = true }), Encoding.UTF8);
    }

    public static void Delete()
    {
        if (File.Exists(FilePath)) File.Delete(FilePath);
    }

    [ObservableProperty] 
    ELanguage _language = ELanguage.English;
    
    [ObservableProperty] 
    EResolution _selectedResolution = EResolution.R720;
    
    [ObservableProperty]
    AssistApplicationType _appType  = AssistApplicationType.COMPLETE;
    
    [ObservableProperty] 
    string _assistUserCode = "";
    
    [ObservableProperty]
    SoundStruct _soundSettings = new SoundStruct();
    
    [ObservableProperty] 
    bool _completedSetup = false;
    
    public string GetAssistUserCode()
    {
        if (Default == null) return null;

        if (string.IsNullOrEmpty(Default.AssistUserCode))
        {
            Log.Information("Attempted to get UserCode for Assist when there is not one.");
            return null;
        }

        return Default.AssistUserCode;
        //return MotionCat.Decrypt(Default.AssistUserCode, MotionCat.GetHardwareId());
    }
    
    public void SaveAssistUserCode(string code)
    {
        if (Default == null) return;
        Default.AssistUserCode = code;
        //Default.AssistUserCode = MotionCat.Encrypt(code, MotionCat.GetHardwareId());
        Save();
    }
    
}