namespace Assist.Shared.Models.Modules.Socket;

public record MatchUpdateMessage
{
    public string MatchId { get; set; } = string.Empty;
    public string MatchState { get; set; } = "UNKNOWN";
    public GameServerInformation ServerInformation { get; set; }= new();
    public GameMapInformation MapInformation { get; set; } = new();
    public GamemodeInformation ModeInformation { get; set; } = new GamemodeInformation();
    public List<PlayerInformation> Players { get; set; } = new List<PlayerInformation>();
    public Dictionary<string, int> LatestTeamScores { get; set; } = new();
};


public record GameServerInformation
{
    public string GamePodId { get; set; }
    public string LocalizedServerName { get; set; }
}

public record GameMapInformation
{
    public string MapPath { get; set; }
    public string LocalizedMapName { get; set; }
}

public record GamemodeInformation
{
    public string GamemodePath { get; set; }
    public string LocalizedGamemodeName { get; set; }
}