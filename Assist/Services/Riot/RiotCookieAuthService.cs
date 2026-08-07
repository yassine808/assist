using System;
using System.Collections.Generic;
using System.IO;
using System.Linq;
using System.Net;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;
using Assist.Models.Riot;
using Assist.Shared.Services.Utils;
using CliWrap;
using Serilog;
using ValNet;
using ValNet.Enums;
using ValNet.Objects;

namespace Assist.Services.Riot;

/// <summary>
/// Exchanges a Riot Client cookie jar for a usable <see cref="RiotUser"/>.
///
/// ValNet's own ReAuthWithCookies/AuthenticateWithCookies cannot do this any more: Riot answers the
/// authorize request with a 303 whose Location carries the tokens, and ValNet fails to read it
/// ("Not Location on Redirect"). Valnet.dll is vendored with no source, so the exchange is done here
/// and the resulting tokens are written into the RiotUser that the rest of the app expects.
/// </summary>
public static class RiotCookieAuthService
{
    private const string AuthorizeUrl =
        "https://auth.riotgames.com/authorize?redirect_uri=https%3A%2F%2Fplayvalorant.com%2Fopt_in" +
        "&client_id=play-valorant-web-prod&response_type=token%20id_token&nonce=1&scope=account%20openid";

    private const string EntitlementsUrl = "https://entitlements.auth.riotgames.com/api/token/v1";
    private const string UserInfoUrl = "https://auth.riotgames.com/userinfo";
    private const string PasUrl = "https://riot-geo.pas.si.riotgames.com/pas/v1/service/chat";
    private const string VersionUrl = "https://valorant-api.com/v1/version";

    // Base64 of the standard Riot client platform blob; the game API rejects requests without it.
    private const string ClientPlatform =
        "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0KCSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0KCSJwbGF0Zm9ybU9TVmVyc2" +
        "lvbiI6ICIxMC4wLjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxhdGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9";

    private const string FallbackClientVersion = "release-13.02-shipping-10-5229475";

    /// <summary>Authenticates from a Riot Client settings file.</summary>
    public static async Task<RiotUser?> AuthenticateAsync(
        List<ClientPrivateModel.RiotCookie> clientCookies,
        string clientRegion)
    {
        if (clientCookies is null || clientCookies.Count == 0)
        {
            Log.Error("RiotCookieAuth: no cookies supplied.");
            return null;
        }

        var jar = new Dictionary<string, Cookie>();
        foreach (var c in clientCookies)
            jar.TryAdd(c.name, new Cookie(c.name, c.value, "/", string.IsNullOrEmpty(c.domain) ? "auth.riotgames.com" : c.domain));

        return await AuthenticateAsync(jar, MapRegion(clientRegion));
    }

    /// <summary>Authenticates from a stored account profile's saved cookie jar.</summary>
    public static async Task<RiotUser?> AuthenticateAsync(Dictionary<string, Cookie> jar, RiotRegion region)
    {
        if (jar is null || jar.Count == 0)
        {
            Log.Error("RiotCookieAuth: no cookies supplied.");
            return null;
        }

        var cookieHeader = string.Join("; ", jar.Values.Select(c => $"{c.Name}={c.Value}"));

        var location = await GetAuthorizeRedirectAsync(cookieHeader);
        if (string.IsNullOrEmpty(location))
        {
            Log.Error("RiotCookieAuth: authorize did not return a redirect. Session is not valid.");
            return null;
        }

        var accessToken = ReadFragmentValue(location, "access_token");
        var idToken = ReadFragmentValue(location, "id_token");

        if (string.IsNullOrEmpty(accessToken))
        {
            Log.Error("RiotCookieAuth: redirect carried no access_token.");
            return null;
        }

        using var http = new HttpClient();
        http.DefaultRequestHeaders.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);

        var entitlementToken = await GetEntitlementTokenAsync(http);
        if (string.IsNullOrEmpty(entitlementToken))
        {
            Log.Error("RiotCookieAuth: failed to get an entitlements token.");
            return null;
        }

        var userData = await GetUserDataAsync(http);
        if (userData is null || string.IsNullOrEmpty(userData.sub))
        {
            Log.Error("RiotCookieAuth: failed to read user info.");
            return null;
        }

        var usr = new RiotUserBuilder()
            .WithRegion(region)
            .WithCustomCurl(CurlPath())
            .WithSettings(new RiotUserSettings { AuthenticationMethod = AuthenticationMethod.CURL })
            .Build();

        usr.TokenData.AccessToken = accessToken;
        usr.TokenData.IdToken = idToken;
        usr.TokenData.EntitlementToken = entitlementToken;
        usr.TokenData.PasToken = await GetPasTokenAsync(http);
        usr.UserData = userData;

        // Keep the jar on the user so the account profile can persist it for later re-auth.
        usr.GetAuthClient().SaveCookies(jar);

        // ValNet normally fills these during its own authentication. Without them every game API
        // call fails - first with "Invalid URI", then with an empty 401 once the URLs are present.
        var shard = ShardFor(region);
        usr.RiotUrls.PdUrl = $"https://pd.{shard}.a.pvp.net";
        usr.RiotUrls.GlzURL = $"https://glz-{region.ToString().ToLowerInvariant()}-1.{shard}.a.pvp.net";

        var clientVersion = await GetClientVersionAsync(http);
        foreach (var client in new[] { usr.DefaultClient, usr.GetAuthClient() })
        {
            client.DefaultRequestHeaders["Authorization"] = "Bearer " + accessToken;
            client.DefaultRequestHeaders["X-Riot-Entitlements-JWT"] = entitlementToken;
            client.DefaultRequestHeaders["X-Riot-ClientPlatform"] = ClientPlatform;
            client.DefaultRequestHeaders["X-Riot-ClientVersion"] = clientVersion;
        }

        Log.Information($"RiotCookieAuth: authenticated {userData.acct?.game_name}#{userData.acct?.tag_line}");
        return usr;
    }

    /// <summary>
    /// Riot's authorize endpoint sits behind Cloudflare, so this goes through curl the same way
    /// ValNet does rather than HttpClient, whose TLS fingerprint gets challenged.
    /// </summary>
    private static async Task<string> GetAuthorizeRedirectAsync(string cookieHeader)
    {
        var stdout = new StringBuilder();
        var stderr = new StringBuilder();

        try
        {
            await Cli.Wrap(CurlPath())
                .WithArguments(new[]
                {
                    "-i", "-s", "-X", "GET", "--http1.1", "--tlsv1.2",
                    "-H", "Content-Type: application/json",
                    "-b", cookieHeader,
                    AuthorizeUrl
                })
                .WithStandardOutputPipe(PipeTarget.ToStringBuilder(stdout))
                .WithStandardErrorPipe(PipeTarget.ToStringBuilder(stderr))
                .WithValidation(CommandResultValidation.None)
                .ExecuteAsync();
        }
        catch (Exception e)
        {
            Log.Error("RiotCookieAuth: curl failed - " + e.Message);
            return string.Empty;
        }

        foreach (var line in stdout.ToString().Split('\n'))
        {
            if (line.StartsWith("Location:", StringComparison.OrdinalIgnoreCase))
                return line.Substring("Location:".Length).Trim();
        }

        return string.Empty;
    }

    private static async Task<string> GetEntitlementTokenAsync(HttpClient http)
    {
        try
        {
            var res = await http.PostAsync(EntitlementsUrl, new StringContent("{}", Encoding.UTF8, "application/json"));
            using var doc = JsonDocument.Parse(await res.Content.ReadAsStringAsync());
            return doc.RootElement.TryGetProperty("entitlements_token", out var t) ? t.GetString() ?? string.Empty : string.Empty;
        }
        catch (Exception e)
        {
            Log.Error("RiotCookieAuth: entitlements request failed - " + e.Message);
            return string.Empty;
        }
    }

    private static async Task<RiotUserData?> GetUserDataAsync(HttpClient http)
    {
        try
        {
            var body = await http.GetStringAsync(UserInfoUrl);
            // RiotUserData exposes public fields rather than properties.
            return JsonSerializer.Deserialize<RiotUserData>(body, new JsonSerializerOptions { IncludeFields = true });
        }
        catch (Exception e)
        {
            Log.Error("RiotCookieAuth: userinfo request failed - " + e.Message);
            return null;
        }
    }

    private static async Task<string> GetPasTokenAsync(HttpClient http)
    {
        // Only needed for chat/presence; a failure here must not block login.
        try
        {
            return (await http.GetStringAsync(PasUrl)).Trim('"');
        }
        catch (Exception e)
        {
            Log.Error("RiotCookieAuth: PAS token request failed - " + e.Message);
            return string.Empty;
        }
    }

    private static async Task<string> GetClientVersionAsync(HttpClient http)
    {
        try
        {
            using var doc = JsonDocument.Parse(await http.GetStringAsync(VersionUrl));
            return doc.RootElement.GetProperty("data").GetProperty("riotClientVersion").GetString() ?? FallbackClientVersion;
        }
        catch (Exception e)
        {
            Log.Error("RiotCookieAuth: could not read the current client version, using the fallback - " + e.Message);
            return FallbackClientVersion;
        }
    }

    /// <summary>BR and LATAM play on the NA shard; everyone else matches their region.</summary>
    private static string ShardFor(RiotRegion region) => region switch
    {
        RiotRegion.BR or RiotRegion.LATAM or RiotRegion.NA => "na",
        RiotRegion.EU => "eu",
        RiotRegion.KR => "kr",
        _ => "ap"
    };

    private static string ReadFragmentValue(string url, string key)
    {
        var hash = url.IndexOf('#');
        if (hash < 0) return string.Empty;

        foreach (var part in url.Substring(hash + 1).Split('&'))
        {
            var split = part.Split('=', 2);
            if (split.Length == 2 && split[0] == key)
                return Uri.UnescapeDataString(split[1]);
        }

        return string.Empty;
    }

    /// <summary>
    /// The Riot Client stores its login shard (EUW, NA1, LA2 ...), not ValNet's coarser region enum.
    /// </summary>
    private static RiotRegion MapRegion(string clientRegion)
    {
        var r = (clientRegion ?? string.Empty).ToUpperInvariant();

        if (r.StartsWith("EU") || r == "TR" || r == "RU") return RiotRegion.EU;
        if (r.StartsWith("NA") || r == "OC1") return RiotRegion.NA;
        if (r.StartsWith("BR")) return RiotRegion.BR;
        if (r.StartsWith("KR") || r == "JP1") return RiotRegion.KR;
        if (r.StartsWith("LA")) return RiotRegion.LATAM;
        if (r.StartsWith("AP") || r == "SG2" || r == "TW2" || r == "VN2" || r == "PH2" || r == "TH2")
            return RiotRegion.AP;

        Log.Warning($"RiotCookieAuth: unmapped client region '{clientRegion}', defaulting to NA.");
        return RiotRegion.NA;
    }

    private static string CurlPath()
    {
        var bundled = Path.Combine(DependencyUtils.CurlDependencyFolder, "curl.exe");
        return File.Exists(bundled) ? bundled : "curl";
    }
}
