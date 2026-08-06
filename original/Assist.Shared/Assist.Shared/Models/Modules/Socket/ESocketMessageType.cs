namespace Assist.Shared.Models.Modules.Socket;

public enum ESocketMessageType : byte
{
    UNKNOWN,
    AGENTUPDATE,
    SCOREUPDATE,
    MATCHUPDATE,
    MATCHRESULT,
    PARTYUPDATE,
    SESSIONINFO
}