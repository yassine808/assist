extends Node

## VALORANT official local API (in-game client) tracker.
##
## While the launched account runs VALORANT, this service reads the game's
## local HTTPS API (rank, RR, wins/losses, last-played) and stores it on the
## active profile so it can be shown on the profile card. It uses the same
## "official API" that Tracker.gg relies on — the local client API — and needs
## no external developer key because it authenticates with the game's lockfile.
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

	var puuid := _fetch_puuid(port, token)
	if puuid.is_empty():
		return

	var name_and_tag := _fetch_name(port, token, puuid)
	var mmr := _fetch_mmr(port, token, puuid)
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


## Fetches the PUUID of the account logged into the running client.
func _fetch_puuid(port: int, token: String) -> String:
	var auth := "riot:%s" % token
	var url := "https://127.0.0.1:%d/personalization/v2/players/playerloadout" % port
	var output: Array = []
	var exit_code := OS.execute("curl.exe", ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000), "-u", auth, url], output, true, false)
	if exit_code != 0 or output.is_empty():
		return ""
	var json: Variant = JSON.parse_string(str(output[0]))
	if json is Dictionary and json.has("Subject"):
		return str(json["Subject"])
	return ""


## Fetches the display name + tag for a PUUID.
func _fetch_name(port: int, token: String, puuid: String) -> String:
	var auth := "riot:%s" % token
	var url := "https://127.0.0.1:%d%s" % [port, ValorantConstants.PATH_NAME % puuid]
	var output: Array = []
	var exit_code := OS.execute("curl.exe", ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000), "-u", auth, url], output, true, false)
	if exit_code != 0 or output.is_empty():
		return ""
	var json: Variant = JSON.parse_string(str(output[0]))
	if json is Dictionary:
		var game_name := str(json.get("gameName", ""))
		var tag := str(json.get("tagLine", ""))
		if not game_name.is_empty():
			return game_name + "#" + tag
	return ""


## Fetches the MMR/rank payload for a PUUID.
func _fetch_mmr(port: int, token: String, puuid: String) -> Dictionary:
	var auth := "riot:%s" % token
	var url := "https://127.0.0.1:%d%s" % [port, ValorantConstants.PATH_MMR % puuid]
	var output: Array = []
	var exit_code := OS.execute("curl.exe", ["-k", "-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000), "-u", auth, url], output, true, false)
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
