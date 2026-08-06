namespace Assist.Shared.Models.Modules.Socket;

public record DefaultMessage
{
    public string Type { get; set; }
    public object Data { get; set; }
};