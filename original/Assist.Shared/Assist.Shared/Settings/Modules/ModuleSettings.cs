using System.Text;
using System.Text.Json;
using Assist.ViewModels;
using CommunityToolkit.Mvvm.ComponentModel;

namespace Assist.Shared.Settings.Modules;

public sealed partial class ModuleSettings : ViewModelBase
{
    public static ModuleSettings Default { get; set; }
    public static readonly string BaseFolderPath = Path.Combine(AssistSettings.FolderPath, "Game", "Modules");
    public static readonly string FilePath = Path.Combine(BaseFolderPath, "ModuleSettings.json");

    
    static ModuleSettings()
    {
        Directory.CreateDirectory(BaseFolderPath);
        Default = new ModuleSettings();
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

    [ObservableProperty] private RichPresenceSettings _richPresenceSettings = new RichPresenceSettings();
}