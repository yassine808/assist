using System.Text.Json.Serialization;

namespace Assist.Objects.AssistApi.Valorant.Skin
{

    public class WeaponSkin
    {

        [JsonPropertyName("uuid")]
        public string Uuid { get; set; }

        [JsonPropertyName("displayName")]
        public string DisplayName { get; set; }

        [JsonPropertyName("themeUuid")]
        public string ThemeUuid { get; set; }

        [JsonPropertyName("displayIcon")]
        public string? DisplayIcon { get; set; }

        [JsonPropertyName("chromas")]
        public WeaponSkinChroma[] Chromas { get; set; }

        [JsonPropertyName("levels")]
        public WeaponSkinLevel[] Levels { get; set; }
    }
}
