using System;
using System.Diagnostics;
using System.IO;
using System.Linq;
using System.Text.RegularExpressions;
using System.Threading;

namespace AccountSwitcher.Services;

/// <summary>
/// Handles closing the Riot Client and swapping the locally-stored session
/// cookie ("ssid") so the next launch picks up the chosen account instead
/// of prompting for a password.
///
/// NOTE: Riot stores this in
///   %LOCALAPPDATA%\Riot Games\Riot Client\Data\RiotClientPrivateSettings.yaml
/// The exact key layout can change between client versions, so
/// FindAndReplaceSsid() below is written defensively (regex over a known
/// key name) rather than assuming a fixed line number. Open the file
/// yourself once and confirm the key name matches your installed client
/// before relying on this — adjust SsidKeyPattern if Riot has changed it.
/// </summary>
public class RiotClientService
{
    private static readonly string PrivateSettingsPath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Riot Games", "Riot Client", "Data", "RiotClientPrivateSettings.yaml");

    // Matches a line like:  ssid: "eyJhbGciOi....."
    private static readonly Regex SsidKeyPattern =
        new(@"(ssid:\s*"")[^""]*("")", RegexOptions.IgnoreCase);

    private static readonly string[] ProcessesToClose =
    {
        "VALORANT-Win64-Shipping",
        "RiotClientUx",
        "RiotClientUxRender",
        "RiotClientServices",
    };

    public bool PrivateSettingsFileFound => File.Exists(PrivateSettingsPath);

    public void CloseRiotClient()
    {
        foreach (var name in ProcessesToClose)
        {
            foreach (var proc in Process.GetProcessesByName(name))
            {
                try
                {
                    proc.Kill();
                    proc.WaitForExit(5000);
                }
                catch
                {
                    // Process may have already exited between enumeration and Kill().
                }
            }
        }

        // Give the OS a moment to release file locks on the settings file.
        Thread.Sleep(750);
    }

    /// <summary>
    /// Swaps the ssid cookie in the private settings file for the given
    /// account's saved value. Returns false if the file or key couldn't be
    /// found, so the caller can surface a clear error instead of silently
    /// doing nothing.
    /// </summary>
    public bool ApplySsid(string ssid)
    {
        if (!File.Exists(PrivateSettingsPath))
            return false;

        var content = File.ReadAllText(PrivateSettingsPath);

        if (!SsidKeyPattern.IsMatch(content))
            return false;

        var updated = SsidKeyPattern.Replace(content, m => $"{m.Groups[1].Value}{ssid}{m.Groups[2].Value}");
        File.WriteAllText(PrivateSettingsPath, updated);
        return true;
    }

    public void LaunchRiotClient()
    {
        // Default install location; adjust if Riot Client is installed elsewhere.
        var exe = @"C:\Riot Games\Riot Client\RiotClientServices.exe";
        if (!File.Exists(exe))
        {
            // Fall back to letting Windows resolve it via the registered
            // launch protocol, if the direct path doesn't exist.
            Process.Start(new ProcessStartInfo("riotclient:") { UseShellExecute = true });
            return;
        }

        Process.Start(new ProcessStartInfo(exe) { UseShellExecute = true });
    }

    /// <summary>
    /// Convenience helper: close client, swap ssid, relaunch.
    /// </summary>
    public bool SwitchTo(string ssid)
    {
        CloseRiotClient();
        var applied = ApplySsid(ssid);
        if (applied)
            LaunchRiotClient();
        return applied;
    }
}
