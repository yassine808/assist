using System;
using System.Text.Json.Serialization;

namespace Assist.Objects.AssistApi.Valorant
{

    public class Bundle
    {

        [JsonPropertyName("dataAssetId")]
        public string DataAssetId { get; set; }

        [JsonPropertyName("name")]
        public string Name { get; set; }

        [JsonPropertyName("description")]
        public string Description { get; set; }

        [JsonPropertyName("extraDescription")]
        public string ExtraDescription { get; set; }

        [JsonPropertyName("promoDescription")]
        public string PromoDescription { get; set; }

        [JsonPropertyName("displayIcon")]
        public string DisplayIcon { get; set; }

        [JsonPropertyName("verticalPromoImage")]
        public string VerticalPromoImage { get; set; }

    }
}
