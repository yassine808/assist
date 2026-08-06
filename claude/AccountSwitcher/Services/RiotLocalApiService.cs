using System;
using System.IO;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Security.Cryptography.X509Certificates;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AccountSwitcher.Services;

/// <summary>
/// Talks to the Riot Client's *local* API (127.0.0.1, random port) to pull
/// the session for whichever account is currently signed in to the running
/// client. This never touches Riot's servers directly - it just reads
/// tokens the client already has, the same way the client's own UI does.
/// </summary>
public class RiotLocalApiService
{
    private static readonly string LockfilePath = Path.Combine(
        Environment.GetFolderPath(Environment.SpecialFolder.LocalApplicationData),
        "Riot Games", "Riot Client", "Config", "lockfile");

    public record LocalSession(string AccessToken, string EntitlementsToken, string Puuid);

    public bool IsRiotClientRunning => File.Exists(LockfilePath);

    /// <summary>
    /// Reads the lockfile (name:pid:port:password:protocol) and requests
    /// the access + entitlements tokens for the currently signed-in account.
    /// </summary>
    public async Task<LocalSession?> GetSessionAsync()
    {
        if (!File.Exists(LockfilePath))
            return null;

        var parts = File.ReadAllText(LockfilePath).Split(':');
        if (parts.Length < 5)
            return null;

        var port = parts[2];
        var password = parts[3];

        using var client = CreateLocalClient(password);

        var response = await client.GetAsync($"https://127.0.0.1:{port}/entitlements/v1/token");
        if (!response.IsSuccessStatusCode)
            return null;

        var json = await response.Content.ReadAsStringAsync();
        using var doc = JsonDocument.Parse(json);
        var root = doc.RootElement;

        var accessToken = root.GetProperty("accessToken").GetString() ?? "";
        var entitlementsToken = root.GetProperty("token").GetString() ?? "";
        var puuid = root.GetProperty("subject").GetString() ?? "";

        if (string.IsNullOrEmpty(accessToken) || string.IsNullOrEmpty(puuid))
            return null;

        return new LocalSession(accessToken, entitlementsToken, puuid);
    }

    private static HttpClient CreateLocalClient(string password)
    {
        // The local API uses a self-signed cert, so cert validation has to
        // be relaxed for this loopback-only connection.
        var handler = new HttpClientHandler
        {
            ServerCertificateCustomValidationCallback = (_, _, _, _) => true
        };
        var client = new HttpClient(handler);

        var basic = Convert.ToBase64String(Encoding.UTF8.GetBytes($"riot:{password}"));
        client.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Basic", basic);
        return client;
    }
}
