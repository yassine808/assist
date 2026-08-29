extends Node

## VALORANT rank/stat tracker backed by the public HenrikDev API.
##
## Rank/MMR is fetched over the internet from a PUUID via the HenrikDev v3
## by-puuid MMR endpoint, which needs NO running client and NO RSO/entitlement
## credentials. This is what makes "rank as soon as the app opens" possible:
##
##   * If a profile already has a stored PUUID (seeded the first time its game
##     ran), `refresh_profile()` can fetch rank any time — including at boot.
##   * A profile with no PUUID yet gets one seeded live, the first time its
##     VALORANT client runs, from the local `/entitlements/v1/token` endpoint
##     (lockfile basic auth `riot:<password>`), plus its region from the
##     ShooterGame log.
##
## So: live capture seeds the identity once; HenrikDev does all rank/stats from
## then on, online or offline-of-the-game.
##
## Blocking curl calls mirror LcuInjector (short, low-frequency, main thread),
## so no worker threads are needed and results apply synchronously.

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


## Fetches rank/stats for a profile from HenrikDev using its stored PUUID, with
## no VALORANT client running. No-op (safe) if the profile has no PUUID yet or
## the feature is disabled. This is the entry point used to satisfy "show rank
## as soon as the app opens".
func refresh_profile(profile_name: String) -> void:
	if not is_enabled():
		return
	var profile := ProfileManager.get_profile(profile_name)
	if profile.is_empty():
		return
	var puuid := str(profile.get("valorant_puuid", ""))
	if puuid.is_empty():
		print("[Valorant/Tracker] '%s': sem PUUID salvo; rank será obtido na próxima vez que o VALORANT rodar." % profile_name)
		return
	var region := str(profile.get("valorant_region", ""))
	_active_profile = profile_name
	_capture_with_identity(puuid, region)


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

	if not _is_valorant_any_process_running():
		return

	_capture_once()


## Live capture: if we already have a stored PUUID for the active profile we can
## fetch rank immediately; otherwise we seed the PUUID/name/region from the
## running client, then fetch.
func _capture_once() -> void:
	var profile := ProfileManager.get_profile(_active_profile)
	var stored_puuid := str(profile.get("valorant_puuid", "")) if not profile.is_empty() else ""
	var stored_region := str(profile.get("valorant_region", "")) if not profile.is_empty() else ""

	# Fast path: identity already known -> fetch rank straight from HenrikDev.
	if not stored_puuid.is_empty():
		_capture_with_identity(stored_puuid, stored_region)
		return

	var lockfile := _valorant_dir
	if lockfile.is_empty():
		lockfile = _find_valorant_dir()
	if lockfile.is_empty():
		print("[Valorant/Tracker] Nenhum diretório de instalação do VALORANT encontrado.")
		return
	lockfile = lockfile.path_join(ValorantConstants.LIVE_DIR_NAME).path_join(ValorantConstants.LOCKFILE_NAME)
	if not FileAccess.file_exists(lockfile):
		print("[Valorant/Tracker] Lockfile não encontrado em: ", lockfile)
		return

	var parts := FileAccess.get_file_as_string(lockfile).strip_edges().split(":")
	# Format: riot:{pid}:{port}:{password}
	if parts.size() < 4 or not parts[0].begins_with("riot"):
		print("[Valorant/Tracker] Lockfile em formato inesperado: ", parts[0])
		return
	var port := int(parts[2])
	var token := parts[3]
	if port <= 0 or token.is_empty():
		print("[Valorant/Tracker] Lockfile com porta/token inválidos.")
		return

	# Seed the account's PUUID (and region) from the running client.
	var session := _fetch_local_session(port, token)
	if session.is_empty():
		print("[Valorant/Tracker] Falha ao obter sessão/entitlements local (porta %d)." % port)
		return
	var puuid: String = str(session.get("subject", ""))
	if puuid.is_empty():
		print("[Valorant/Tracker] Sessão local sem PUUID completo.")
		return
	if stored_region.is_empty():
		stored_region = _resolve_shard()
	if not stored_region.is_empty():
		_seed_identity(_active_profile, puuid, stored_region)
		print("[Valorant/Tracker] Identidade semeada: puuid='%s' region='%s'." % [puuid, stored_region])

	_capture_with_identity(puuid, stored_region)


## Persists the account identity discovered from a live session, so future
## fetches (including at app boot) work without the game running.
func _seed_identity(profile_name: String, puuid: String, region: String) -> void:
	var profile := ProfileManager.get_profile(profile_name)
	if profile.is_empty():
		return
	profile["valorant_puuid"] = puuid
	profile["valorant_region"] = region
	ProfileManager.update_valorant_data(profile_name, profile.get("valorant_data", {}), puuid, "")


## Fetches rank/stats from HenrikDev for a known PUUID + region and stores it on
## the profile (`_active_profile`). The in-game name is recovered from the same
## payload (`account.name#tag`), so it needs no separate service call. Empty
## region falls back to the profile's stored value; skipped if still empty.
func _capture_with_identity(puuid: String, region: String) -> void:
	if puuid.is_empty():
		return
	if region.is_empty():
		var profile := ProfileManager.get_profile(_active_profile)
		region = str(profile.get("valorant_region", "")) if not profile.is_empty() else ""
	if region.is_empty():
		print("[Valorant/Tracker] '%s': região desconhecida — não foi possível consultar o HenrikDev." % _active_profile)
		return

	print("[Valorant/Tracker] Consultando HenrikDev: region='%s' puuid='%s'." % [region, puuid])
	var mmr := _fetch_mmr_henrikdev(region, puuid)
	if mmr.is_empty():
		print("[Valorant/Tracker] MMR vazio retornado do HenrikDev.")
	var data := _build_data(mmr)
	var payload: Variant = mmr.get("data") if mmr.has("data") else {} 
	var in_game_name := ""
	if payload is Dictionary:
		var account: Variant = (payload as Dictionary).get("account")
		if account is Dictionary:
			var game_name := str((account as Dictionary).get("name", ""))
			var tag := str((account as Dictionary).get("tag", ""))
			if not game_name.is_empty():
				in_game_name = game_name + "#" + tag
	_apply(puuid, region, in_game_name, data)


func _apply(puuid: String, region: String, in_game_name: String, data: Dictionary) -> void:
	var profile := ProfileManager.get_profile(_active_profile)
	if profile.is_empty():
		return
	var profile_name: String = _active_profile

	if not puuid.is_empty():
		profile["valorant_puuid"] = puuid
	if not region.is_empty():
		profile["valorant_region"] = region
	profile["valorant_data"] = data

	ProfileManager.update_valorant_data(profile_name, data, puuid, in_game_name)
	valorant_data_updated.emit(profile_name)
	print("[Valorant/Tracker] Rank capturado para '%s': %s (%d RR)." % [profile_name, data.get(ValorantConstants.KEY_RANK_NAME, ""), data.get(ValorantConstants.KEY_RR, 0)])


## Builds the compact rank/stats dictionary from the HenrikDev v3 MMRV3Response
## payload (`data` = mmr["data"]). Tolerates missing/partial fields.
func _build_data(mmr: Dictionary) -> Dictionary:
	var data := {
		ValorantConstants.KEY_TIER: 0,
		ValorantConstants.KEY_RANK_NAME: ValorantConstants.rank_name_from_tier(0),
		ValorantConstants.KEY_RR: 0,
		ValorantConstants.KEY_PEAK_RANK: "",
		ValorantConstants.KEY_WINS: 0,
		ValorantConstants.KEY_LOSSES: 0,
		ValorantConstants.KEY_GAMES: 0,
		# NOTE: KEY_LAST_PLAYED_MS is intentionally omitted — HenrikDev's MMR
		# payload carries no last-match timestamp, so a 0 here would wipe the
		# profile's tracked "last used" time. Leave it out; ProfileManager
		# preserves the prior value.
		ValorantConstants.KEY_LAST_UPDATED_MS: int(Time.get_unix_time_from_system()) * 1000,
		ValorantConstants.KEY_ACT_ID: "",
	}

	var tier := 0
	var tier_name := ""
	var rr := 0
	var wins := 0
	var games := 0
	var peak_name := ""
	var act_id := ""

	var payload: Variant = mmr.get("data")
	if payload is Dictionary:
		var current: Variant = (payload as Dictionary).get("current")
		if current is Dictionary:
			var current_dict: Dictionary = current
			tier = int(current_dict.get("tier", {}).get("id", 0)) if (current_dict.get("tier") is Dictionary) else 0
			tier_name = str(current_dict.get("tier", {}).get("name", "")) if (current_dict.get("tier") is Dictionary) else ""
			rr = int(current_dict.get("rr", 0))
			wins = int(current_dict.get("wins", 0))
			games = int(current_dict.get("games_played", 0))

		var peak: Variant = (payload as Dictionary).get("peak")
		if peak is Dictionary and (peak as Dictionary).get("tier") is Dictionary:
			peak_name = str((peak as Dictionary).get("tier", {}).get("name", ""))

		var seasonal: Variant = (payload as Dictionary).get("seasonal")
		if seasonal is Array and (seasonal as Array).size() > 0 and wins == 0 and games == 0:
			var latest: Dictionary = (seasonal as Array)[0]
			wins = int(latest.get("wins", 0))
			games = int(latest.get("games", 0))
			act_id = str(latest.get("season", ""))

	# Rank display: prefer the concrete name the API returned; fall back to the
	# numeric-tier mapping (covers "Unranked"/empty cases).
	data[ValorantConstants.KEY_TIER] = tier
	data[ValorantConstants.KEY_RANK_NAME] = tier_name if not tier_name.is_empty() else ValorantConstants.rank_name_from_tier(tier)
	data[ValorantConstants.KEY_RR] = rr
	data[ValorantConstants.KEY_WINS] = wins
	data[ValorantConstants.KEY_LOSSES] = maxi(0, games - wins)
	data[ValorantConstants.KEY_GAMES] = maxi(0, games)
	data[ValorantConstants.KEY_PEAK_RANK] = peak_name
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


## Fetches rank/MMR + name/tag for a PUUID from the public HenrikDev API.
## Returns `mmr` with `{"data": {...}}` (v3 MMRV3Response) or {} on failure.
func _fetch_mmr_henrikdev(region: String, puuid: String) -> Dictionary:
	var path := ValorantConstants.PATH_MMR_BY_PUUID % [region, ValorantConstants.PLATFORM, puuid]
	var url := ValorantConstants.HENRIKDEV_BASE + path
	var args: Array[String] = ["-s", "-m", str(ValorantConstants.CURL_TIMEOUT_MS / 1000)]
	# HenrikDev expects the raw key as the Authorization value (NO "Bearer "
	# prefix). The prefix causes a 401 — verified live against the real API.
	args.append("-H")
	args.append("Authorization: " + ValorantConstants.HENRIKDEV_API_KEY)
	args.append("-H")
	args.append("User-Agent: RiotSwitcher/1.0")
	args.append(url)
	var output: Array = []
	var exit_code := OS.execute("curl.exe", args, output, true, false)
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


func _is_valorant_any_process_running() -> bool:
	for process_name in ValorantConstants.PROCESS_VALORANT_NAMES:
		if _is_process_running(process_name):
			return true
	return false


func _is_process_running(process_name: String) -> bool:
	var output: Array = []
	var exit_code := OS.execute("tasklist", ["/FI", "IMAGENAME eq %s" % process_name, "/NH"], output, true, false)
	if exit_code == 0:
		for chunk: String in output:
			if chunk.to_lower().contains(process_name.to_lower()):
				return true
	return false
