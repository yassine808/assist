using Assist.Models.Enums;

namespace Assist.Shared.Settings.Modules;

public class RichPresenceSettings
{
    public bool IsEnabled { get; set; } = false;
    
    public bool ShowAgent { get; set; } = true;
    public bool ShowRank { get; set; } = true;
    public bool ShowScore { get; set; } = true;
    public bool ShowMode { get; set; } = true;
    public bool ShowParty { get; set; } = true;
    
    public bool EnableDiscordInvite { get; set; } = false;

    public ERPDataType LargeImageData { get; set; }= ERPDataType.MAP; // Map, Agent, Logo, None Defaults: Map
    public ERPDataType SmallImageData { get; set; }= ERPDataType.RANK; // Agent, Rank, None Defaults: Rank
}