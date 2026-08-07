using System.Collections.Generic;
using Assist.Core.Helpers;

namespace Assist.Helpers;

/// <summary>
/// Assist's own CDN (cdn.assistval.com) is gone along with the rest of the project's backend, so
/// every image it used to serve now 404s. These helpers point at valorant-api.com instead, which
/// serves the same Riot artwork keyed by UUID.
/// </summary>
public static class AssistCdn
{
    private const string Media = "https://media.valorant-api.com";

    /// <summary>Current competitive tier set. Riot adds a new set rarely; tier numbers are stable.</summary>
    private const string CompetitiveTierSet = "03621f52-342b-cf4e-4f86-9350a49c6d04";

    public static string AgentIcon(string agentId) =>
        string.IsNullOrEmpty(agentId) ? string.Empty : $"{Media}/agents/{agentId.ToLower()}/displayicon.png";

    public static string PlayerCardIcon(string cardId) =>
        string.IsNullOrEmpty(cardId) ? string.Empty : $"{Media}/playercards/{cardId.ToLower()}/displayicon.png";

    public static string PlayerCardLargeArt(string cardId) =>
        string.IsNullOrEmpty(cardId) ? string.Empty : $"{Media}/playercards/{cardId.ToLower()}/largeart.png";

    public static string RankIcon(int tier) =>
        $"{Media}/competitivetiers/{CompetitiveTierSet}/{tier}/largeicon.png";

    public static string RankIcon(string tier) =>
        $"{Media}/competitivetiers/{CompetitiveTierSet}/{tier}/largeicon.png";

    /// <summary>Small map icon used in match lists. Empty when the map is unknown to us.</summary>
    public static string MapListIcon(string mapPath)
    {
        var uuid = ValorantHelper.GetMapUuidByPath(mapPath);
        return string.IsNullOrEmpty(uuid) ? string.Empty : $"{Media}/maps/{uuid}/listviewicon.png";
    }

    /// <summary>Large map art used on the live/pregame screens.</summary>
    public static string MapFeatured(string mapPath)
    {
        var uuid = ValorantHelper.GetMapUuidByPath(mapPath);
        return string.IsNullOrEmpty(uuid) ? string.Empty : $"{Media}/maps/{uuid}/splash.png";
    }
}
