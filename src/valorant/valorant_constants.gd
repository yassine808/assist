class_name ValorantConstants
extends RefCounted

## Constants for the VALORANT official local (in-game client) API integration.
##
## VALORANT's rank/MMR data is served by the *running* VALORANT client over a
## local HTTPS API on 127.0.0.1, exactly like League's LCU. This is the same
## "official API" that Tracker.gg and overlay tools use: it needs no external
## developer key because it authenticates with the game's own lockfile.
##
## The lockfile lives in the VALORANT *live* folder and is formatted like
## League's: `riot:{pid}:{port}:{password}` (basic auth = `riot:<password>`).

const PROCESS_VALORANT_NAME := "VALORANT.exe"

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
const POLL_INTERVAL_SEC := 10.0
const MAX_POLL_ATTEMPTS := 12 # 12 * 10s = 120s of live capture

## curl connectivity + timing.
const CURL_TIMEOUT_MS := 8000

## Local API endpoints (hosted by the running client on 127.0.0.1, served with
## lockfile basic auth `riot:<password>`).
# Returns { subject (PUUID), accessToken, token (entitlement JWT), expiry }.
const PATH_TOKEN := "/entitlements/v1/token"
# Returns the current clientVersion (e.g. "VALORANT 10.10.0.0").
const PATH_VERSIONS := "/system/v1/products/valorant/versions"

## Server-side "pd" API host, templated with the account's shard/region.
## These endpoints require the 4 RSO headers below, NOT lockfile basic auth.
const PD_PREFIX := "https://pd.%s.a.pvp.net"

## Rank/MMR + display name paths (relative to PD_PREFIX, templated with PUUID).
# /mmr/v1/players/{puuid}   -> QueueSkills -> SeasonalInfoBySeasonID
# /name-service/v2/players/{puuid} -> { gameName, tagLine }
const PATH_MMR := "/mmr/v1/players/%s"
const PATH_NAME := "/name-service/v2/players/%s"

## X-Riot-ClientPlatform header value. Fixed, well-known base64-encoded JSON that
## identifies a PC/Windows Riot client (used by every VALORANT tracker/overlay).
const X_RIOT_CLIENT_PLATFORM := "eyJwbGF0Zm9ybVR5cGUiOiJQQyIsInBsYXRmb3JtT1MiOiJXaW5kb3dzIiwicGxhdGZvcm1PU1ZlcnNpb24iOiIxMC4wLjE5MDQyLjEiLCJwbGF0Zm9ybUNoaXBzZXQiOiJVbmtub3duIn0="

## Relative path (from %LOCALAPPDATA%) to the ShooterGame log used to detect the
## account's shard/region via: glz-{SHARD}-1.{region}.a.pvp.net
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
