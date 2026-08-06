using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Net.Http.Headers;
using System.Net.Http.Json;
using System.Text;
using System.Text.Json;
using System.Threading.Tasks;

namespace AccountSwitcher.Services;

public record StoreOffer(string SkinId, string DisplayName);
public record LiveMatchPlayer(string Puuid, string AgentName, string TeamId);

/// <summary>
/// Calls Riot's regional pd/glz servers directly using the tokens obtained
/// from <see cref="RiotLocalApiService"/> - the same servers the game
/// client itself talks to. These are community-documented, unofficial
/// endpoints (not a public API Riot guarantees), so field names/paths can
/// change between patches. If a call starts failing, check
/// https://valapidocs.techchrism.me for the current shape.
/// </summary>
public class RiotRemoteApiService
{
    // Known client platform blob every third-party tool sends; identifies
    // the request as coming from a PC client.
    private const string ClientPlatformJson =
        "{\"platformType\":\"PC\",\"platformOS\":\"Windows\",\"platformOSVersion\":\"10.0.19042.1.256.64bit\",\"platformChipset\":\"Unknown\"}";

    private readonly HttpClient _http = new();
    private Dictionary<string, string>? _skinNameCache;
    private Dictionary<string, string>? _agentNameCache;

    /// <summary>
    /// Riot's own geo-affinity lookup: given an access token, returns which
    /// shard (na/eu/ap/kr) that account's live data lives on.
    /// </summary>
    public async Task<string> GetShardAsync(string accessToken)
    {
        using var req = new HttpRequestMessage(HttpMethod.Put,
            "https://riot-geo.pas.si.riotgames.com/pas/v1/product/valorant");
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        req.Content = new StringContent("{\"id_token\":\"" + accessToken + "\"}", Encoding.UTF8, "application/json");

        var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());
        return doc.RootElement.GetProperty("affinities").GetProperty("live").GetString() ?? "na";
    }

    public async Task<string> GetClientVersionAsync()
    {
        var resp = await _http.GetFromJsonAsync<JsonElement>("https://valorant-api.com/v1/version");
        return resp.GetProperty("data").GetProperty("riotClientVersion").GetString() ?? "";
    }

    private async Task<HttpRequestMessage> BuildRequestAsync(HttpMethod method, string url,
        string accessToken, string entitlementsToken, string clientVersion)
    {
        var req = new HttpRequestMessage(method, url);
        req.Headers.Authorization = new AuthenticationHeaderValue("Bearer", accessToken);
        req.Headers.Add("X-Riot-Entitlements-JWT", entitlementsToken);
        req.Headers.Add("X-Riot-ClientVersion", clientVersion);
        req.Headers.Add("X-Riot-ClientPlatform",
            Convert.ToBase64String(Encoding.UTF8.GetBytes(ClientPlatformJson)));
        await Task.CompletedTask;
        return req;
    }

    /// <summary>Today's shop offers for this account, with names resolved.</summary>
    public async Task<List<StoreOffer>> GetStorefrontAsync(
        string shard, string puuid, string accessToken, string entitlementsToken, string clientVersion)
    {
        var url = $"https://pd.{shard}.a.pvp.net/store/v3/storefront/{puuid}";
        using var req = await BuildRequestAsync(HttpMethod.Post, url, accessToken, entitlementsToken, clientVersion);
        req.Content = new StringContent("{}", Encoding.UTF8, "application/json");

        var resp = await _http.SendAsync(req);
        resp.EnsureSuccessStatusCode();
        using var doc = JsonDocument.Parse(await resp.Content.ReadAsStringAsync());

        var offers = new List<StoreOffer>();
        var skinIds = doc.RootElement
            .GetProperty("SkinsPanelLayout")
            .GetProperty("SingleItemOffers");

        var names = await GetSkinNamesAsync();
        foreach (var idEl in skinIds.EnumerateArray())
        {
            var id = idEl.GetString() ?? "";
            names.TryGetValue(id, out var name);
            offers.Add(new StoreOffer(id, name ?? id));
        }
        return offers;
    }

    /// <summary>
    /// Live match roster: checks pre-game (agent select) first, then the
    /// in-progress core-game, since a puuid only ever matches one of them.
    /// Returns an empty list if the account isn't currently in a match.
    /// </summary>
    public async Task<List<LiveMatchPlayer>> GetLiveMatchAsync(
        string shard, string region, string puuid, string accessToken, string entitlementsToken, string clientVersion)
    {
        var glz = $"https://glz-{region}-1.{shard}.a.pvp.net";
        var agentNames = await GetAgentNamesAsync();

        // Pre-game (agent select) first.
        var pregame = await TryGetMatchAsync(
            $"{glz}/pregame/v1/players/{puuid}", $"{glz}/pregame/v1/matches/{{0}}",
            accessToken, entitlementsToken, clientVersion, agentNames, isPregame: true);
        if (pregame.Count > 0)
            return pregame;

        // Otherwise check the live in-progress match.
        return await TryGetMatchAsync(
            $"{glz}/core-game/v1/players/{puuid}", $"{glz}/core-game/v1/matches/{{0}}",
            accessToken, entitlementsToken, clientVersion, agentNames, isPregame: false);
    }

    private async Task<List<LiveMatchPlayer>> TryGetMatchAsync(
        string playerUrl, string matchUrlTemplate, string accessToken, string entitlementsToken,
        string clientVersion, Dictionary<string, string> agentNames, bool isPregame)
    {
        var result = new List<LiveMatchPlayer>();

        using var playerReq = await BuildRequestAsync(HttpMethod.Get, playerUrl, accessToken, entitlementsToken, clientVersion);
        var playerResp = await _http.SendAsync(playerReq);
        if (!playerResp.IsSuccessStatusCode)
            return result; // not currently in this phase of a match

        using var playerDoc = JsonDocument.Parse(await playerResp.Content.ReadAsStringAsync());
        var matchId = playerDoc.RootElement.GetProperty("MatchID").GetString();
        if (string.IsNullOrEmpty(matchId))
            return result;

        var matchUrl = string.Format(matchUrlTemplate, matchId);
        using var matchReq = await BuildRequestAsync(HttpMethod.Get, matchUrl, accessToken, entitlementsToken, clientVersion);
        var matchResp = await _http.SendAsync(matchReq);
        if (!matchResp.IsSuccessStatusCode)
            return result;

        using var matchDoc = JsonDocument.Parse(await matchResp.Content.ReadAsStringAsync());
        var playersProp = isPregame ? "AllyTeam" : "Players"; // pregame only exposes your own team pre-select
        // Core-game exposes "Players" directly; pregame nests allies under AllyTeam.Players.
        var playersArray = isPregame
            ? matchDoc.RootElement.GetProperty("AllyTeam").GetProperty("Players")
            : matchDoc.RootElement.GetProperty("Players");

        foreach (var p in playersArray.EnumerateArray())
        {
            var pPuuid = p.GetProperty("Subject").GetString() ?? "";
            var characterId = p.TryGetProperty("CharacterID", out var c) ? c.GetString() ?? "" : "";
            var teamId = p.TryGetProperty("TeamID", out var t) ? t.GetString() ?? "" : "";
            agentNames.TryGetValue(characterId, out var agentName);
            result.Add(new LiveMatchPlayer(pPuuid, agentName ?? "Unlocked yet", teamId));
        }
        return result;
    }

    private async Task<Dictionary<string, string>> GetSkinNamesAsync()
    {
        if (_skinNameCache != null)
            return _skinNameCache;

        var resp = await _http.GetFromJsonAsync<JsonElement>("https://valorant-api.com/v1/weapons/skins/levels");
        var map = new Dictionary<string, string>();
        foreach (var item in resp.GetProperty("data").EnumerateArray())
        {
            var uuid = item.GetProperty("uuid").GetString();
            var name = item.GetProperty("displayName").GetString();
            if (uuid != null && name != null)
                map[uuid] = name;
        }
        _skinNameCache = map;
        return map;
    }

    private async Task<Dictionary<string, string>> GetAgentNamesAsync()
    {
        if (_agentNameCache != null)
            return _agentNameCache;

        var resp = await _http.GetFromJsonAsync<JsonElement>("https://valorant-api.com/v1/agents");
        var map = new Dictionary<string, string>();
        foreach (var item in resp.GetProperty("data").EnumerateArray())
        {
            var uuid = item.GetProperty("uuid").GetString();
            var name = item.GetProperty("displayName").GetString();
            if (uuid != null && name != null)
                map[uuid] = name;
        }
        _agentNameCache = map;
        return map;
    }
}
