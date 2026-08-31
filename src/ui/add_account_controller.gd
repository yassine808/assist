class_name AddAccountController
extends Control

## "Add Riot account" flow. There is no manual form: clicking "Add Riot
## account" opens the Riot Client and the app then watches the *live* Riot
## account (via the Riot Client's private session file) and, as soon as a
## brand-new account logs in — regardless of game (League, VALORANT, or
## anything else) — automatically creates a full profile for it.
##
## The account identity is decoded from the Riot Client JWT, so it needs no
## manual name input, description, or background picker.

signal profile_created_successfully
signal warning_dismissed

const CLIENT_EXE := "RiotClientServices.exe"
const POLL_INTERVAL_SEC := 2.0
const MAX_POLL_SEC := 180.0

## Injected by Main.
var profile_manager: Node
var riot_client_location: String = ""

var _watching := false
var _poll_timer: Timer = null
var _elapsed := 0.0
var _created_profile_name := ""

@onready var _status_label: Label = $Panel/status_label
@onready var _detail_label: Label = $Panel/detail_label
@onready var _error_label: Label = $Panel/error_label
@onready var _cancel_button: Button = $Panel/cancel_button

var _cascade_tweens: Array[Tween] = []


func _ready() -> void:
	_poll_timer = Timer.new()
	_poll_timer.one_shot = false
	_poll_timer.wait_time = POLL_INTERVAL_SEC
	_poll_timer.timeout.connect(_on_poll_tick)
	add_child(_poll_timer)
	_cancel_button.pressed.connect(on_cancel_pressed)
	reset_form()


## Injected by Main.
func set_profile_manager(pm: Node) -> void:
	profile_manager = pm


func set_riot_client_location(client_location: String) -> void:
	riot_client_location = client_location


func set_warning_visibility(_visible_: bool) -> void:
	pass


func reset_form() -> void:
	_stop_watching()
	_status_label.text = "Opening Riot Client..."
	_detail_label.text = ""
	_error_label.visible = false
	_cancel_button.visible = false


## Starts the flow: opens the Riot Client and begins watching for a new login.
func start_add_flow() -> void:
	reset_form()
	if not _launch_riot_client():
		return
	_watching = true
	_elapsed = 0.0
	_status_label.text = "Opening Riot Client..."
	_detail_label.text = "Waiting for a new Riot account to sign in..."
	_cancel_button.visible = true
	_poll_timer.start()


func _launch_riot_client() -> bool:
	if riot_client_location.is_empty():
		_show_error("Riot Client location is not set.")
		return false
	var executable_path := riot_client_location.path_join(CLIENT_EXE)
	if not FileAccess.file_exists(executable_path):
		_show_error("Could not find Riot Client at:\n" + executable_path)
		return false

	var launch_args: Array[String] = ["--launch-patchline=live"]
	launch_args.insert(0, "--launch-product=riot")
	var pid := OS.create_process(executable_path, launch_args)
	if pid < 0:
		_show_error("Failed to launch Riot Client.")
		return false
	print("[AddAccount] Riot Client launched (PID %d)." % pid)
	return true


func _on_poll_tick() -> void:
	if not _watching:
		return
	_elapsed += POLL_INTERVAL_SEC
	if _elapsed > MAX_POLL_SEC:
		_status_label.text = "Timed out"
		_detail_label.text = "No new account detected. Close and reopen this window to try again."
		_stop_watching()
		return

	var account := RiotAccountDetect.read_live_account()
	if account.is_empty():
		return

	if not RiotAccountDetect.is_account_new(account, profile_manager.get_profiles()):
		_detail_label.text = "Sign in to a NEW Riot account to add it..."
		return

	_create_profile_from_account(account)


func _create_profile_from_account(account: Dictionary) -> void:
	if not profile_manager:
		_show_error("Internal error: Profile Manager not available.")
		return

	var uid := RiotAccountDetect.display_uid(account)
	var profile_name := uid if not uid.is_empty() else _generate_auto_profile_name()
	var puuid := str(account.get("puuid", ""))
	var region := str(account.get("riot_region", "")).to_lower()
	var uname := str(account.get("uname", ""))

	# If a profile with this identity already exists (race), skip.
	for existing in profile_manager.get_profiles():
		if existing is Dictionary and str(existing.get("valorant_puuid", "")) == puuid:
			_show_error("That account is already added.")
			_stop_watching()
			return

	if not profile_manager.add_profile(profile_name, "", true, ""):
		_show_error("Failed to create profile. Check logs.")
		return

	var created_id := uid if not uid.is_empty() else uname
	profile_manager.update_valorant_data(profile_name, {}, puuid, created_id, region)
	_created_profile_name = profile_name

	if ValorantTracker != null:
		ValorantTracker.refresh_profile(profile_name)

	print("[AddAccount] Auto-added profile '%s' (%s)." % [profile_name, uid])
	_status_label.text = "Account added!"
	_detail_label.text = "Added %s. Returning to your profiles..." % uid
	_cancel_button.visible = false
	_stop_watching()
	call_deferred("_finish")


func _finish() -> void:
	profile_created_successfully.emit()


func on_cancel_pressed() -> void:
	_stop_watching()
	profile_created_successfully.emit()


func _stop_watching() -> void:
	_watching = false
	if _poll_timer:
		_poll_timer.stop()


func _generate_auto_profile_name() -> String:
	if not profile_manager:
		return "Account 1"
	var index := 1
	while profile_manager.has_profile("Account %d" % index):
		index += 1
	return "Account %d" % index


func _show_error(message: String) -> void:
	_error_label.text = message
	_error_label.visible = true
	_cancel_button.visible = true
	_detail_label.text = ""
	_stop_watching()


## Plays a subtle fade entrance for the minimal status view.
func play_cascade_entrance() -> void:
	for tw in _cascade_tweens:
		if tw and tw.is_valid():
			tw.kill()
	_cascade_tweens.clear()

	var panel := get_node_or_null("Panel") as Control
	if not panel:
		return
	panel.modulate.a = 0.0
	var tw := panel.create_tween().set_parallel(true)
	_cascade_tweens.append(tw)
	tw.tween_property(panel, "modulate:a", 1.0, 0.20).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
