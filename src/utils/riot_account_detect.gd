class_name RiotAccountDetect
extends RefCounted

## Single source of truth for reading and decoding the *currently logged-in*
## Riot account identity from the live Riot Client session file
## (RiotGamesPrivateSettings.yaml on disk). The Riot Client writes a JWT
## (`id_token.riot-client.authorization`) whose payload carries the account:
##   - sub           : account PUUID (stable, game-agnostic id)
##   - acct.game_name: in-game name
##   - acct.tag_line : tagline (#tag)
##   - lol[].uname   : League username
##   - lol[].cpid    : League platform (region)
##
## Because the profile system swaps this very file per profile, the "live"
## file always reflects whichever account is currently active in the Riot
## Client. This lets the app detect "a new Riot account just logged in"
## regardless of game (League / VALORANT / anything else) and auto-add it.

const RPC_SUB := "sub"
const RPC_ACCT := "acct"
const RPC_GAME_NAME := "game_name"
const RPC_TAG_LINE := "tag_line"
const RPC_LOL := "lol"
const RPC_UNAME := "uname"
const RPC_CPID := "cpid"

## Returns the local path of the live Riot Client private settings file,
## or "" if unavailable.
static func live_settings_path() -> String:
	var local_app_data := OS.get_environment("LOCALAPPDATA")
	if local_app_data.is_empty():
		return ""
	return local_app_data.path_join("Riot Games/Riot Client/Data/RiotGamesPrivateSettings.yaml")


## Reads and decodes the currently logged-in Riot account from the live Riot
## Client session file. Returns an empty Dictionary when unavailable.
## Result keys: "puuid", "game_name", "tag_line", "uname", "riot_region".
static func read_live_account() -> Dictionary:
	var yaml_path := live_settings_path()
	if yaml_path.is_empty() or not FileAccess.file_exists(yaml_path):
		return {}

	var yaml := FileAccess.get_file_as_string(yaml_path)
	if yaml.is_empty():
		return {}

	var id_token := _extract_id_token(yaml)
	if id_token.is_empty():
		return {}

	var payload := _decode_jwt_payload(id_token)
	if payload.is_empty():
		return {}

	var result := {}
	var acct: Dictionary = payload.get(RPC_ACCT, {}) if payload.get(RPC_ACCT) is Dictionary else {}
	if not str(payload.get(RPC_SUB, "")).is_empty():
		result["puuid"] = str(payload[RPC_SUB])
	if not str(acct.get(RPC_GAME_NAME, "")).is_empty():
		result["game_name"] = str(acct[RPC_GAME_NAME])
	if not str(acct.get(RPC_TAG_LINE, "")).is_empty():
		result["tag_line"] = str(acct[RPC_TAG_LINE])

	var lol: Array = payload.get(RPC_LOL, []) if payload.get(RPC_LOL) is Array else []
	if not lol.is_empty() and lol[0] is Dictionary:
		if not str(lol[0].get(RPC_UNAME, "")).is_empty():
			result["uname"] = str(lol[0][RPC_UNAME])
		if not str(lol[0].get(RPC_CPID, "")).is_empty():
			result["riot_region"] = str(lol[0][RPC_CPID])

	return result


## Returns true when the given account identity is not tracked by any profile.
## [param profiles] is an Array of profile Dictionaries (as returned by
## ProfileManager.get_profiles()).
static func is_account_new(account: Dictionary, profiles: Array) -> bool:
	var puuid := str(account.get("puuid", ""))
	if puuid.is_empty():
		return false
	for profile in profiles:
		if profile is Dictionary and str(profile.get("valorant_puuid", "")) == puuid:
			return false
	return true


## Builds a display UID like "name#tag" from an account Dictionary.
static func display_uid(account: Dictionary) -> String:
	var name := str(account.get("game_name", "")).strip_edges()
	var tag := str(account.get("tag_line", "")).strip_edges()
	if name.is_empty():
		return ""
	if not tag.is_empty():
		return "%s#%s" % [name, tag]
	return name


## Extracts the `id_token` value under `authorization.riot-client` from the
## YAML text. Returns "" when absent.
static func _extract_id_token(yaml_text: String) -> String:
	var match := RegEx.create_from_string('id_token:\\s*"([^"]+)"')
	if not match:
		return ""
	var result := match.search(yaml_text)
	if result:
		return result.get_string(1)
	return ""


## Decodes the payload segment of a JWT (base64url) to a Dictionary.
## Only checks structure and required claim presence; the signature is not
## verified here (the Riot Client itself authenticated the token).
static func _decode_jwt_payload(token: String) -> Dictionary:
	var parts := token.split(".")
	if parts.size() < 2:
		return {}
	var payload := parts[1].replace("-", "+").replace("_", "/")
	while payload.length() % 4 != 0:
		payload += "="
	var bytes := Marshalls.base64_to_raw(payload)
	if bytes.is_empty():
		return {}
	var data := bytes.get_string_from_utf8()
	var json := JSON.new()
	if json.parse(data) != OK or not (json.data is Dictionary):
		return {}
	return json.data
