using System.Collections.Generic;
using System.Text.Json.Serialization;
using ValNet.Objects.Local;

namespace Assist.Models.Socket;

public class PresenceV4Message
{
    [JsonPropertyName("data")]
    public Data MessageData { get; set; }
    [JsonPropertyName("eventType")]
    public string EventType { get; set; }
    
    [JsonPropertyName("uri")]
    public string Uri { get; set; }

    public class Data
    {
        [JsonPropertyName("presences")]
        public List<ChatV4PresenceObj.Presence> Presences { get; set; }
    }
}