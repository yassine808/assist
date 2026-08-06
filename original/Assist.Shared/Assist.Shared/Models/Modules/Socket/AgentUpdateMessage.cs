namespace Assist.Shared.Models.Modules.Socket;

public record PlayerInformation
{
    public string PlayerId { get; set; } = string.Empty;
    public string? TeamId { get; set; } = string.Empty;
    public PlayerPersonalization Personalization { get; set; } = new PlayerPersonalization();
    public string? SelectedAgentId { get; set; } = string.Empty;
    public bool IsLocked { get; set; } = false;
}