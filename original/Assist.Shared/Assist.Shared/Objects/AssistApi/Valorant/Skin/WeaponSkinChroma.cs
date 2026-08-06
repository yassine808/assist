using System.Text.Json.Serialization;

namespace Assist.Objects.AssistApi.Valorant.Skin
{
    public class WeaponSkinChroma
    {
        [JsonPropertyName("chromaUuid")]
        public string ChromaUuid { get; set; }

        [JsonPropertyName("displayName")]
        public string DisplayName { get; set; }

        [JsonPropertyName("displayIcon")]
        public string DisplayIcon { get; set; }

        [JsonPropertyName("streamedVideoUrl")]
        public object StreamedVideoUrl { get; set; }
    }
}