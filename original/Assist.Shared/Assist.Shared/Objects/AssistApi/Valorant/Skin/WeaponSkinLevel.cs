using System.Text.Json.Serialization;

namespace Assist.Objects.AssistApi.Valorant.Skin{

public class WeaponSkinLevel
{

    [JsonPropertyName("levelUuid")]
    public string LevelUuid { get; set; }

    [JsonPropertyName("displayName")]
    public string DisplayName { get; set; }

    [JsonPropertyName("displayIcon")]
    public string DisplayIcon { get; set; }

    [JsonPropertyName("streamedVideoUrl")]
    public object StreamedVideoUrl { get; set; }

}
}
