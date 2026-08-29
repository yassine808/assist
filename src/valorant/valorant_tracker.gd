extends Node

## VALORANT rank/stat tracker.
##
## VALORANT does NOT expose rank/MMR through the local in-client HTTP API. Rank
## lives on the server-side `pd.{shard}.a.pvp.net` API, which requires RSO
## credentials (access + entitlement tokens) that are themselves only obtainable
## from the local client. So the capture is a two-stage flow, same as every
## VALORANT tracker/overlay:
##
##   1. Read the lockfile (basic auth `riot:<password>`) and call the LOCAL
##      `/entitlements/v1/token` endpoint to get the PUUID, access token and
##      entitlement JWT.
##   2. Resolve the account shard from ShooterGame.log and the client version,
##      then call `pd.{shard}.a.pvp.net` (name-service + mmr) with the four RSO
##      headers (Authorization, X-Riot-Entitlements-JWT, X-Riot-ClientPlatform,
##      X-Riot-ClientVersion).
##
## Results are stored on the active profile so the card can show rank/RR/W-L.
##
## Blocking curl calls mirror LcuInjector (they are short, low-frequency, and
## run inside the poll timer on the main thread), so no worker threads are
## needed and results are applied synchronously.

signal valorant_data_updated(profile_name: String)

enum State {
	IDLE,
	POLLING,
}

const CONFIG_KEY_ENABLED := "ValorantTrackerEnabled"

var _state: State = State.IDLE
var _poll_timer: Timer = null
var _active_profile := ""
var _valorant_dir := ""
var _attempts := 0

const MAX_POLL_ATTEMPTS := 30 # 30 * 10s = 300s of live capture window
const POLL_INTERVAL_SEC := 10.0


func _ready() -> void:
	_poll_timer = Timer.new()
	_poll_timer.wait_time = POLL_INTERVAL_SEC
	_poll_timer.one_shot = false
	_poll_timer.timeout.connect(_on_tick)
	add_child(_poll_timer)
	print("[Valorant/Tracker] Initialized. Feature enabled: ", is_enabled())


func is_enabled() -> bool:
	return bool(ConfigManager.get_value(CONFIG_KEY_ENABLED, true))


## Called by the grid controller when a profile is launched so rank/stats are
## attributed to the right account. Pass "" to stop (client stopped).
func set_active_profile(profile_name: String) -> void:
	_active_profile = profile_name
	if profile_name.is_empty():
		stop()
	else:
		start()


func enable(value: bool) -> void:
	ConfigManager.set_value_and_save(CONFIG_KEY_ENABLED, value)
	if value:
		start()
	else:
		stop()


## Starts the capture watchdog for the active profile.
func start() -> void:
	if _active_profile.is_empty() or not is_enabled():
		return
	if _state == State.POLLING:
		return
	_attempts = 0
	_valorant_dir = _find_valorant_dir()
	_state = State.POLLING
	_poll_timer.start()
	print("[Valorant/Tracker] Watchdog ativo para capturar rank em: ", _valorant_dir)
	_on_tick()


## Stops the capture watchdog.
func stop() -> void:
	_state = State.IDLE
	if _poll_timer and is_instance_valid(_poll_timer):
		_poll_timer.stop()


func _on_tick() -> void:
	if _state != State.POLLING:
		return

	_attempts += 1
	if _attempts > MAX_POLL_ATTEMPTS:
		print("[Valorant/Tracker] Tempo limite atingido aguardando VALORANT.")
		stop()
		return

	if not _is_process_running(ValorantConstants.PROCESS_VALORANT_NAME):
		return

	_capture_once()


func _capture_once() -> void:
	var lockfile := _valorant_dir
	if lockfile.is_empty():
		lockfile = _find_valorant_dir()
	if lockfile.is_empty():
		return
	lockfile = lockfile.path_join(ValorantConstants.LIVE_DIR_NAME).path_join(ValorantConstants.LOCKFILE_NAME)
	if not FileAccess.file_exists(lockfile):
		return

	var parts := FileAccess.get_file_as_string(lockfile).strip_edges().split(":")
	# Format: riot:{pid}:{port}:{password}
	if parts.size() < 4 or not parts[0].begins_with("riot"):
		return
	var pid := int(parts[1])
	var port := int(parts[2])
	var token := parts[3]
	if pid <= 0 or port <= 0 or token.is_empty():
		return

	# 1) Pull RSO tokens + PUUID from the LOCAL entitlements endpoint. This is
	#    the only local endpoint that yields the server-side credentials needed
	#    to query rank/MMR, and it works with lockfile basic auth.
	var session := _fetch_local_session(port, token)
	if session.is_empty():
		return
	var puuid: String = str(session.get("subject", ""))
	var access_token: String = str(session.get("access_token", ""))
	var entitlement_token: String = str(session.get("entitlement_token", ""))
	if puuid.is_empty() or access_token.is_empty() or entitlement_token.is_empty():
		return

	# 2) Resolve the shard/region and client version required by the "pd" API.
	var shard := _resolve_shard()
	var client_version := _fetch_client_version(port, token)

	var name_and_tag := ""
	var mmr: Dictionary = {}
	if not shard.is_empty():
		name_and_tag = _fetch_name_pd(shard, puuid, access_token, entitlement_token, client_version)
		mmr = _fetch_mmr_pd(shard, puuid, access_token, entitlement_token, client_version)

	var data := _build_data(mmr)
	_apply(pid, _active_profile, puuid, name_and_tag, data)


func _apply(pid: int, profile_name: String, puuid: String, name_and_tag: String, data: Dictionary) -> void:
	var profile := ProfileManager.get_profile(profile_name)
	if profile.is_empty():
		return

	if not puuid.is_empty():
		profile["valorant_puuid"] = puuid
	if not name_and_tag.is_empty():
		profile["valorant_in_game_name"] = name_and_tag
	profile["valorant_data"] = data
	profile["last_valorant_use"] = int(data.get(ValorantConstants.KEY_LAST_PLAYED_MS, 0))

	ProfileManager.update_valorant_data(profile_name, data, puuid, name_and_tag)
	valorant_data_updated.emit(profile_name)
	print("[Valorant/Tracker] Rank capturado para '%s': %s (%d RR)." % [profile_name, data.get(ValorantConstants.KEY_RANK_NAME, ""), data.get(ValorantConstants.KEY_RR, 0)])


## Builds the compact rank/stats dictionary from the raw MMR response.
func _build_data(mmr: Dictionary) -> Dictionary:
	var data := {
		ValorantConstants.KEY_TIER: 0,
		ValorantConstants.KEY_RANK_NAME: ValorantConstants.rank_name_from_tier(0),
		ValorantConstants.KEY_RR: 0,
		ValorantConstants.KEY_PEAK_RANK: "",
		ValorantConstants.KEY_WINS: 0,
		ValorantConstants.KEY_LOSSES: 0,
		ValorantConstants.KEY_GAMES: 0,
		ValorantConstants.KEY_LAST_PLAYED_MS: 0,
		ValorantConstants.KEY_LAST_UPDATED_MS: int(Time.get_unix_time_from_system()) * 1000,
		ValorantConstants.KEY_ACT_ID: "",
	}

	var tier := 0
	var rr := 0
	var wins := 0
	var losses := 0
	var games := 0
	var last_played := 0
	var act_id := ""

	var update: Dictionary = mmr.get("LatestCompetitiveUpdate", {})
	if update is Dictionary:
		last_played = int(update.get("MatchStartTime", 0))

	# Representative current act = the season with the most ranked games.
	var best := {}
	var best_games := -1
	var queue_skills: Dictionary = mmr.get("QueueSkills", {})
	for queue_key: String in queue_skills.keys():
		var queue: Dictionary = queue_skills[queue_key]
		if not (queue is Dictionary):
			continue
		var seasonal: Dictionary = queue.get("SeasonalInfoBySeasonID", {})
		if not (seasonal is Dictionary):
			continue
		for season_id: String in seasonal.keys():
			var info: Dictionary = seasonal[season_id]
			if not (info is Dictionary):
				continue
			var season_games := int(info.get("NumberOfGames", 0))
			if season_games > best_games:
				best_games = season_games
				best = info
				act_id = season_id

	if not best.is_empty():
		tier = int(best.get("CompetitiveTier", 0))
		rr = int(best.get("RankedRating", 0))
		wins = int(best.get("NumberOfWins", 0))
		losses = maxi(0, best_games - wins)

	# Peak rank = highest tier across all seasons of the competitive queue.
	var peak_tier := tier
	for queue_key: String in queue_skills.keys():
		var queue: Dictionary = queue_skills[queue_key]
		if not (queue is Dictionary):
			continue
		var seasonal: Dictionary = queue.get("SeasonalInfoBySeasonID", {})
		if not (seasonal is Dictionary):
			continue
		for season_id: String in seasonal.keys():
			var info: Dictionary = seasonal[season_id]
			if not (info is Dictionary):
				continue
			var t := int(info.get("CompetitiveTier", 0))
			if t > peak_tier:
				peak_tier = t

	data[ValorantConstants.KEY_TIER] = tier
	data[ValorantConstants.KEY_RANK_NAME] = ValorantConstants.rank_name_from_tier(tier)
	data[ValorantConstants.KEY_RR] = rr
	data[ValorantConstants.KEY_WINS] = wins
	data[ValorantConstants.KEY_LOSSES] = losses
	data[ValorantConstants.KEY_GAMES] = games
	data[ValorantConstants.KEY_LAST_PLAYED_MS] = last_played
	data[ValorantConstants.KEY_PEAK_RANK] = ValorantConstants.rank_name_from_tier(peak_tier)
	data[ValorantConstants.KEY_ACT_ID] = act_id

	return data


## Fetches PUUID + RSO tokens (access + entitlement) from the local client.
## Returns an empty Dictionary on any failure so the capture is skipped safely.
func _fetch_local_session(port: int, token: String) -> Dictionary:
	var auth := "riot:%s" % token
	var url := "https://127.0.0.1:%d%s" % [port, ValorantConstants.PATH_TOKEN]
	var output: Array = []
	var exit_code := OS.execute("curl.exe", ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000), "-u", auth, url], output, true, false)
	if exit_code != 0 or output.is_empty():
		return {}
	var json: Variant = JSON.parse_string(str(output[0]))
	if not (json is Dictionary):
		return {}
	var result: Dictionary = json
	return {
		"subject": str(result.get("subject", "")),
		"access_token": str(result.get("accessToken", "")),
		"entitlement_token": str(result.get("token", "")),
	}


## Resolves the account's shard/region from the ShooterGame log so the pd API
## can be addressed (`pd.{shard}.a.pvp.net`). Empty string if undeterminable.
func _resolve_shard() -> String:
	var log_path := OS.get_environment("LOCALAPPDATA").path_join(ValorantConstants.SHOOTER_LOG_REL)
	if not FileAccess.file_exists(log_path):
		return ""
	var f := FileAccess.open(log_path, FileAccess.READ)
	if not f:
		return ""
	var text := f.get_as_text()
	f.close()
	if text.is_empty():
		return ""
	var re := RegEx.new()
	if re.compile(ValorantConstants.SHARD_REGEX) != OK:
		return ""
	var m := re.search(text)
	if m and m.get_string_count() >= 2:
		return m.get_string(1)
	return ""


## Fetches the current client version needed by the X-Riot-ClientVersion header
## from the local `/system/v1/products/valorant/versions` endpoint.
func _fetch_client_version(port: int, token: String) -> String:
	var auth := "riot:%s" % token
	var url := "https://127.0.0.1:%d%s" % [port, ValorantConstants.PATH_VERSIONS]
	var output: Array = []
	var exit_code := OS.execute("curl.exe", ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000), "-u", auth, url], output, true, false)
	if exit_code != 0 or output.is_empty():
		return ""
	var json: Variant = JSON.parse_string(str(output[0]))
	if json is Dictionary:
		return str((json as Dictionary).get("clientVersion", ""))
	return ""


## Builds the curl argument list for the server-side "pd" API with RSO headers.
func _pd_curl_args(shard: String, puuid: String, access_token: String, entitlement_token: String, client_version: String, path: String) -> Array[String]:
	var url := (ValorantConstants.PD_PREFIX % shard) + (path % puuid)
	var args: Array[String] = ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000)]
	args.append("-H")
	args.append("Authorization: Bearer " + access_token)
	args.append("-H")
	args.append("X-Riot-Entitlements-JWT: " + entitlement_token)
	args.append("-H")
	args.append("X-Riot-ClientPlatform: " + ValorantConstants.X_RIOT_CLIENT_PLATFORM)
	if not client_version.is_empty():
		args.append("-H")
		args.append("X-Riot-ClientVersion: " + client_version)
	args.append(url)
	return args


## Fetches the display name + tag for a PUUID from the server-side pd API.
func _fetch_name_pd(shard: String, puuid: String, access_token: String, entitlement_token: String, client_version: String) -> String:
	var output: Array = []
	var exit_code := OS.execute("curl.exe", _pd_curl_args(shard, puuid, access_token, entitlement_token, client_version, ValorantConstants.PATH_NAME), output, true, false)
	if exit_code != 0 or output.is_empty():
		return ""
	var json: Variant = JSON.parse_string(str(output[0]))
	if json is Dictionary:
		var game_name := str((json as Dictionary).get("gameName", ""))
		var tag := str((json as Dictionary).get("tagLine", ""))
		if not game_name.is_empty():
			return game_name + "#" + tag
	return ""


## Fetches the MMR/rank payload for a PUUID from the server-side pd API.
func _fetch_mmr_pd(shard: String, puuid: String, access_token: String, entitlement_token: String, client_version: String) -> Dictionary:
	var output: Array = []
	var exit_code := OS.execute("curl.exe", _pd_curl_args(shard, puuid, access_token, entitlement_token, client_version, ValorantConstants.PATH_MMR), output, true, false)
	if exit_code != 0 or output.is_empty():
		return {}
	var json: Variant = JSON.parse_string(str(output[0]))
	if json is Dictionary:
		return json
	return {}


func _find_valorant_dir() -> String:
	var from_registry := _valorant_dir_from_registry()
	if not from_registry.is_empty():
		return from_registry

	var from_installs := _valorant_dir_from_installs_json()
	if not from_installs.is_empty():
		return from_installs

	var from_metadata := _valorant_dir_from_metadata_yaml()
	if not from_metadata.is_empty():
		return from_metadata

	for drive: String in ValorantConstants.COMMON_INSTALL_DRIVES:
		var candidate := drive + ValorantConstants.COMMON_INSTALL_PATH
		if DirAccess.dir_exists_absolute(candidate):
			return candidate

	return ""


func _valorant_dir_from_registry() -> String:
	for reg_key in ValorantConstants.REG_KEYS:
		var output: Array = []
		var exit_code := OS.execute("reg", ["query", reg_key, "/v", "InstallLocation"], output, true, false)
		if exit_code != 0:
			continue
		for chunk: String in output:
			for line in chunk.split("\n", false):
				if line.contains("InstallLocation") and line.contains("REG_SZ"):
					var parts := line.split("REG_SZ", false, 1)
					if parts.size() >= 2:
						var dir := parts[1].strip_edges()
						if DirAccess.dir_exists_absolute(dir):
							return dir
	return ""


func _valorant_dir_from_installs_json() -> String:
	if not FileAccess.file_exists(ValorantConstants.RIOT_INSTALLS_JSON):
		return ""
	var data: Variant = JSON.parse_string(FileAccess.get_file_as_string(ValorantConstants.RIOT_INSTALLS_JSON))
	if not (data is Dictionary):
		return ""
	var data_dict: Dictionary = data

	var associated: Variant = data_dict.get("associated_client", {})
	if associated is Dictionary:
		for path_key: String in (associated as Dictionary).keys():
			var p := str(path_key).trim_suffix("/").trim_suffix("\\")
			if p.to_lower().ends_with("valorant") and DirAccess.dir_exists_absolute(p):
				return p

	var configurable: Variant = data_dict.get("configurable_product_paths", {})
	if configurable is Dictionary:
		for product in (configurable as Dictionary).values():
			if product is Array:
				for path_key: String in (product as Array):
					var p := str(path_key).trim_suffix("/").trim_suffix("\\")
					if p.to_lower().ends_with("valorant") and DirAccess.dir_exists_absolute(p):
						return p
	return ""


func _valorant_dir_from_metadata_yaml() -> String:
	if not FileAccess.file_exists(ValorantConstants.RIOT_METADATA_YAML):
		return ""
	var f := FileAccess.open(ValorantConstants.RIOT_METADATA_YAML, FileAccess.READ)
	if not f:
		return ""
	while not f.eof_reached():
		var line := f.get_line().strip_edges()
		if line.begins_with("product_install_full_path:"):
			var parts := line.split(":", false, 1)
			if parts.size() >= 2:
				var path := parts[1].strip_edges().trim_prefix("\"").trim_suffix("\"").trim_prefix("'").trim_suffix("'")
				if DirAccess.dir_exists_absolute(path):
					return path
	return ""


func _is_process_running(process_name: String) -> bool:
	var output: Array = []
	var exit_code := OS.execute("tasklist", ["/FI", "IMAGENAME eq %s" % process_name, "/NH"], output, true, false)
	if exit_code == 0:
		for chunk: String in output:
			if chunk.to_lower().contains(process_name.to_lower()):
				return true
	return false
