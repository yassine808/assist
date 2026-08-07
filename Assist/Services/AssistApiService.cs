using System;
using System.Collections.Generic;
using System.Net.Http;
using System.Text.Json;
using System.Threading.Tasks;
using Assist.Models.Enums;
using Assist.Objects.AssistApi;
using Assist.Objects.AssistApi.Valorant;
using Assist.Objects.AssistApi.Valorant.Battlepass;
using Assist.Objects.AssistApi.Valorant.Offer;
using Assist.Objects.AssistApi.Valorant.Skin;
using Assist.Shared.Services.Utils;
using Assist.Shared.Settings;
using Serilog;

namespace Assist.Services
{
    public class AssistApiService
    {
        public const string BaseUrl = "https://live.assistval.com";
        public const string BattlepassId = "2b3a941d-4b85-a0df-5beb-8897224d290a";

        private const string FailedNewsArticleImageUrl =
            "https://images.contentstack.io/v3/assets/bltb6530b271fddd0b1/blta8463fc941226152/638a967c34be4631e02db299/12062022_eoy_2022_16x9_banner.jpg";
        private const int MaintenanceTimeoutInSeconds = 5;

        //private readonly ILogger _logger;
        private readonly HttpClient _client;

        public AssistApiService()
        {
            //_logger = Log.ForContext<AssistApiService>();
            _client = new HttpClient()
            {
              BaseAddress   = new Uri(BaseUrl),
              // The Assist backend is offline; without a short timeout every call blocks the UI for
              // the full default 100 seconds before failing.
              Timeout = TimeSpan.FromSeconds(5)
            };
        }

        /// <summary>
        /// The Assist backend no longer exists, so every call here throws on connect. Callers run
        /// from async void UI handlers where an exception reaches the dispatcher and kills the app,
        /// so failures are swallowed to null and each caller falls back to its own default.
        /// </summary>
        private async Task<HttpResponseMessage?> TryGetAsync(string path)
        {
            try
            {
                return await _client.GetAsync(path);
            }
            catch (Exception e)
            {
                Log.Error($"AssistApi: request to {path} failed - {e.Message}");
                return null;
            }
        }

        // todo: handle unsuccessful response
        public async Task<WeaponSkin?> GetWeaponSkinAsync(string uuid)
        {
            
            
            var response = await TryGetAsync($"/api/valorant/skins/{uuid}/");
            if (response is { IsSuccessStatusCode: true })
            {
                var data = await response.Content.ReadAsStringAsync();
                return JsonSerializer.Deserialize<WeaponSkin>(data);
            }

            return null;
        }

        public async Task<string> GetWeaponSkinPriceAsync(string uuid)
        {
            
            var response = await TryGetAsync($"/api/valorant/offers/{uuid}/");
            if (response is { IsSuccessStatusCode: true })
            {
                var data = await response.Content.ReadAsStringAsync();
                var obj =  JsonSerializer.Deserialize<StoreOffer>(data);

                return $"{obj!.Cost.Cost:n0}";
            }

            return $"";
            
           
        }
        
        private static NewsArticle CreateFailedNewsTab()
        {
            return new NewsArticle
            {
                title = "VALORANT 2022 YEAR-END",
                description = "Celebrate the year with actual content! we know we havent given you any recently",
                imageUrl = FailedNewsArticleImageUrl,
                nodeUrl = "https://playvalorant.com/en-us/news/game-updates/valorant-2022-year-end/"
            };
        }

        public async Task<Bundle> GetBundleAsync(string id)
        {
            var response = await TryGetAsync($"/api/valorant/bundles/{id}/");
            if (response is not { IsSuccessStatusCode: true })
                return CreateFailedBundle();
            
            var data = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<Bundle>(data);
        }

        public async Task<List<Mission>> GetAllMissions()
        {
            var response = await TryGetAsync($"/api/valorant/missions");
            
            if (response is not { IsSuccessStatusCode: true })
                return new List<Mission>()
                {
                    new Mission
                    {
                        Title = "Error",
                        ProgressToComplete = 1,
                        XpGrant = 1,
                    }
                };
            var data = await response.Content.ReadAsStringAsync();
            return JsonSerializer.Deserialize<List<Mission>>(data);
        }
        private static Bundle CreateFailedBundle()
        {
            return new Bundle
            {
                Name = "Could not find bundle on server",
                Description = "Please contact Mike to fix this issue.",
                DisplayIcon = "https://cdn.rumblemike.com/Bundles/2116a38e-4b71-f169-0d16-ce9289af4bfa_DisplayIcon.png"
            };
        }
        
    }
}
