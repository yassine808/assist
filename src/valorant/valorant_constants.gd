class_name ValorantConstants
extends RefCounted

## Constants for VALORANT rank/stat integration via the public HenrikDev API.
##
## Unlike Riot's "pd"/RSO server-side endpoints (which require credentials only
## obtainable from a running client, PLUS a fragile shard/region + client-version
## dance), the HenrikDev API exposes rank/MMR for a PUUID over the public
## internet with a single request. This lets the app show rank/stats **as soon
## as it opens** from a stored PUUID, with no VALORANT client running.
##
## The v3 by-puuid MMR endpoint returns everything in one payload:
##   account{name,tag} -> in-game name
##   current{tier,r rr,elo} -> current rank + RR
##   peak{tier{name}} -> peak rank
##   seasonal[] -> wins/games per act (for W/L)
##
## Auth: API key (HDEV-...) sent as `Authorization: Bearer HDEV-...`.

const PROCESS_VALORANT_NAMES: Array[String] = ["VALORANT-Win64-Shipping.exe", "VALORANT.exe"]

## All the places Riot's installer can register the VALORANT install directory.
const REG_KEYS: Array[String] = [
	"HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Riot Game valorant.live",
	"HKLM\\SOFTWARE\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Riot Game valorant.live",
	"HKLM\\SOFTWARE\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\Riot Game valorant.live",
]

## Riot Client's canonical install manifest (JSON) and per-game metadata YAML.
const RIOT_INSTALLS_JSON := "C:/ProgramData/Riot Games/RiotClientInstalls.json"
const RIOT_METADATA_YAML := "C:/ProgramData/Riot Games/Metadata/valorant.live/valorant.live.product_settings.yaml"

## Sub-folder (relative to the install dir root) that holds the lockfile.
const LIVE_DIR_NAME := "live"
const LOCKFILE_NAME := "lockfile"

## Known base install locations scanned as a final fallback.
const COMMON_INSTALL_DRIVES: Array[String] = ["D:", "C:", "E:", "F:", "G:"]
const COMMON_INSTALL_PATH := "/Riot Games/VALORANT"

## How long to keep polling (and how often) while VALORANT is running.
## (Used only by the live-capture watchdog path.)
const POLL_INTERVAL_SEC := 10.0
const MAX_POLL_ATTEMPTS := 12 # 12 * 10s = 120s of live capture

## curl connectivity + timing.
const CURL_TIMEOUT_MS := 8000

## HenrikDev public API base + MMR v3 by-puuid path.
const HENRIKDEV_BASE := "https://api.henrikdev.xyz"
# {region}, {platform}, {puuid} -> MMRV3Response
const PATH_MMR_BY_PUUID := "/valorant/v3/by-puuid/mmr/%s/%s/%s"
const PLATFORM := "pc"

## Local `.env` file, looked up next to the executable (project root in the
## editor, alongside the binary in packaged builds). Ownrs supply their own
## HenrikDev API key here — it is never hardcoded in source.
const ENV_FILENAME := ".env"
const ENV_KEY_HENRIKDEV := "HENRIKDEV_API_KEY"


## Returns the HenrikDev API key from `res://.env`. Returns "" if the key is
## missing so the caller can log and skip the request instead of sending a
## hardcoded credential.
static func api_key() -> String:
	var env_path := ProjectSettings.globalize_path("res://" + ENV_FILENAME)
	if FileAccess.file_exists(env_path):
		var f := FileAccess.open(env_path, FileAccess.READ)
		if f:
			while not f.eof_reached():
				var line := f.get_line().strip_edges()
				if line.is_empty() or line.begins_with("#"):
					continue
				if line.begins_with(ENV_KEY_HENRIKDEV + "="):
					var value := line.trim_prefix(ENV_KEY_HENRIKDEV + "=").strip_edges()
					f.close()
					if not value.is_empty():
						return value.trim_prefix("\"").trim_suffix("\"").strip_edges()
			f.close()
	return ""

## Local API endpoint (hosted only by a *running* client on 127.0.0.1, served
## with lockfile basic auth `riot:<password>`). Returns { subject (PUUID),
## accessToken, token (entitlement JWT) }. Used only to seed a profile's PUUID
## the first time the game runs; rank itself is fetched from HenrikDev.
const PATH_TOKEN := "/entitlements/v1/token"

## Relative path (from %LOCALAPPDATA%) to the ShooterGame log used to detect the
## account's shard/region via: glz-{SHARD}-1.{region}.a.pvp.net. The region is
## persisted on the profile so HenrikDev can be queried later without the game.
const SHOOTER_LOG_REL := "VALORANT/Saved/Logs/ShooterGame.log"
const SHARD_REGEX := "glz-([a-z0-9]+)-1\\.[a-z0-9]+\\.a\\.pvp\\.net"

## Rank/MMR cache keys stored in a profile's `valorant_data` dict.
const KEY_TIER := "tier"
const KEY_RANK_NAME := "rank_name"
const KEY_RR := "rr"
const KEY_PEAK_RANK := "peak_rank_name"
const KEY_WINS := "wins"
const KEY_LOSSES := "losses"
const KEY_GAMES := "games"
const KEY_LAST_PLAYED_MS := "last_played_ms"
const KEY_LAST_UPDATED_MS := "last_updated_ms"
const KEY_ACT_ID := "act_id"

## Tier id -> human readable rank name (0 = Unranked).
## https://support-valorant.riotgames.com (competitive tiers)
static func rank_name_from_tier(tier: int) -> String:
	var names := {
		0: "Unranked",
		1: "Unrated",
		3: "Iron 1", 4: "Iron 2", 5: "Iron 3",
		6: "Bronze 1", 7: "Bronze 2", 8: "Bronze 3",
		9: "Silver 1", 10: "Silver 2", 11: "Silver 3",
		12: "Gold 1", 13: "Gold 2", 14: "Gold 3",
		15: "Platinum 1", 16: "Platinum 2", 17: "Platinum 3",
		18: "Diamond 1", 19: "Diamond 2", 20: "Diamond 3",
		21: "Ascendant 1", 22: "Ascendant 2", 23: "Ascendant 3",
		24: "Immortal 1", 25: "Immortal 2", 26: "Immortal 3",
		27: "Radiant",
	}
	if names.has(tier):
		return names[tier]
	return "Unranked"
