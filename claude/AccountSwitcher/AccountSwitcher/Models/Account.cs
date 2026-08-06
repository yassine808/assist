using System;

namespace AccountSwitcher.Models;

/// <summary>
/// Represents one saved account entry. "Ssid" is the local Riot Client
/// session cookie value the user copies from their own already-logged-in
/// session, so switching doesn't require re-entering a password.
/// </summary>
public class Account
{
    public string Id { get; set; } = Guid.NewGuid().ToString("N");
    public string DisplayName { get; set; } = "";
    public string Ssid { get; set; } = "";
    public DateTime AddedAt { get; set; } = DateTime.UtcNow;
    public DateTime? LastUsedAt { get; set; }
}
