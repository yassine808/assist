@tool
class_name ProfileButton
extends Control

## A single profile card in the grid. It only handles presentation and user
## input; all heavy work (killing processes, swapping session files) is
## orchestrated by ProfileGridController, which confirms state changes back
## through confirm_started()/confirm_stopped()/reset_toggle_state().

#region Glow Customization (Inspector)
@export_group("Glow Settings")
## Ative para ver e ajustar o glow ao vivo no editor!
@export var preview_glow: bool = false:
	set(value):
		preview_glow = value
		_update_glow_preview()

@export var glow_color: Color = Color(1.0, 0.04, 0.14, 1.0):
	set(value):
		glow_color = value
		_update_glow()

@export_range(0.0, 3.0, 0.05) var glow_intensity: float = 1.3:
	set(value):
		glow_intensity = value
		_update_glow()

@export_range(0.5, 6.0, 0.1) var glow_spread: float = 1.8:
	set(value):
		glow_spread = value
		_update_glow()

@export var glow_rect_size: Vector2 = Vector2(0.26, 0.10):
	set(value):
		glow_rect_size = value
		_update_glow()
#endregion

signal client_toggled(profile_button: Control, is_starting: bool)
signal delete_requested(profile_button: Control)
signal edit_requested(profile_button: Control)

const PLAY_ICON: Texture2D = preload("res://assets/icons/ui/icon_play.png")
const STOP_ICON: Texture2D = preload("res://assets/icons/ui/icon_stop.png")
const DRAG_THRESHOLD := 6.0
const HOVER_FADE_IN_TIME := 0.08
const HOVER_FADE_OUT_TIME := 0.08
const HOVER_SCALE_FACTOR := 1.04

## Full profile dictionary from ProfileManager. Set right after instantiation.
var profile_data: Dictionary = {}

var client_is_running := false
var _is_interactable := true
var _is_transitioning := false

# Drag & click state
var _is_mouse_down := false
var _drag_start_pos := Vector2.ZERO

@onready var _context_menu: Control = get_node_or_null("card/context_menu")
@onready var _delete_button: TextureButton = get_node_or_null("card/context_menu/Panel/delete/TextureButton")
@onready var _edit_button: TextureButton = get_node_or_null("card/context_menu/Panel/edit/TextureButton")
@onready var _glow_effect: Control = $glow if has_node("glow") else find_child("glow", true, false)
@onready var _button: Button = get_node_or_null("card/card_inner/Button")
@onready var _state_icon: TextureRect = get_node_or_null("card/card_inner/Button/TextureRect")
@onready var _card: Control = get_node_or_null("card")
@onready var _profile_name_label: Label = $profile_name if has_node("profile_name") else null
@onready var _desc_label: Label = get_node_or_null("card/desc_label")
@onready var _valorant_rank_icon: TextureRect = get_node_or_null("card/valorant_rank_icon")
@onready var _valorant_rank_label: Label = get_node_or_null("card/valorant_rank")
@onready var _valorant_stats_label: Label = get_node_or_null("card/valorant_stats")
@onready var _valorant_agent_label: Label = get_node_or_null("card/valorant_agent")
@onready var _valorant_combat_label: Label = get_node_or_null("card/valorant_combat")

## Always-visible top-right "✕" delete button and its confirmation dialog. The
## button is built in code (self-drawn ✕ texture) so no icon asset is required.
var _delete_btn: Button = null
var _delete_btn_icon: TextureRect = null
var _confirm_dialog: ConfirmationDialog = null

# Skeleton placeholder shown while this card has a VALORANT PUUID configured but
# rank/stats have not been fetched yet (refresh pending / in flight / failed).
var _skeleton_root: Control = null
var _skeleton_bars: Array[Control] = []
var _skeleton_tween: Tween = null

var _glow_tween: Tween = null


var profile_name: String:
	get: return profile_data.get("profile_name", "")


func _ready() -> void:
	_update_glow()
	_update_glow_preview()

	if Engine.is_editor_hint():
		return

	_build_skeleton()

	if _delete_button:
		_delete_button.pressed.connect(_on_delete_button_pressed)
	if _edit_button:
		_edit_button.pressed.connect(_on_edit_button_pressed)
	if _card:
		_card.gui_input.connect(_on_card_gui_input)
	if _button and _button is Button:
		if not _button.pressed.is_connected(_on_profile_button_pressed):
			_button.pressed.connect(_on_profile_button_pressed)
		_button.mouse_entered.connect(_on_card_mouse_entered)
		_button.mouse_exited.connect(_on_card_mouse_exited)
	if _context_menu:
		_context_menu.visible = false
	if _glow_effect:
		_glow_effect.modulate.a = 0.0
		_glow_effect.scale = Vector2(0.96, 0.96)
		_glow_effect.pivot_offset = _glow_effect.size * 0.5

	_build_delete_button()
	_build_confirm_dialog()

	# Always-visible card text (description + rank/RR + W/L + agent + combat) —
	# no hover popup.
	_apply_valorant_display(profile_data)
	_relayout_card_text()
	set_process_input(true)


func _update_glow() -> void:
	var glow_node: Control = _glow_effect if _glow_effect else (get_node_or_null("glow") as Control)
	if not glow_node or not glow_node.material is ShaderMaterial:
		return
	var mat: ShaderMaterial = glow_node.material as ShaderMaterial
	mat.set_shader_parameter("rect_size", glow_rect_size)
	mat.set_shader_parameter("bness", glow_intensity)
	mat.set_shader_parameter("fall_off_scale", glow_spread)
	mat.set_shader_parameter("glow_color", glow_color)
	mat.set_shader_parameter("glow_color_secondary", glow_color.darkened(0.25))


func _update_glow_preview() -> void:
	var glow_node: Control = _glow_effect if _glow_effect else (get_node_or_null("glow") as Control)
	if not glow_node:
		return
	if preview_glow:
		glow_node.modulate.a = 1.0
		glow_node.scale = Vector2(1.04, 1.04)
	else:
		if Engine.is_editor_hint():
			glow_node.modulate.a = 0.0
			glow_node.scale = Vector2(0.96, 0.96)


#region State confirmation (called by ProfileGridController)

## Confirms the client for this profile is now running.
func confirm_started() -> void:
	client_is_running = true
	_is_transitioning = false
	if _state_icon:
		_state_icon.texture = STOP_ICON


## Confirms the client was stopped and the session saved.
func confirm_stopped() -> void:
	client_is_running = false
	_is_transitioning = false
	if _state_icon:
		_state_icon.texture = PLAY_ICON


## Reverts the toggle after a failed start/stop attempt.
func reset_toggle_state() -> void:
	client_is_running = false
	_is_transitioning = false
	if _state_icon:
		_state_icon.texture = PLAY_ICON

#endregion

#region On-card delete button & confirmation

## Builds the always-visible "✕" delete button in the top-right corner of the
## card, plus the Godot ConfirmationDialog that guards a destructive delete.
func _build_delete_button() -> void:
	if not _card or _delete_btn:
		return
	_delete_btn = Button.new()
	_delete_btn.name = "delete_btn"
	_delete_btn.flat = true
	_delete_btn.mouse_default_cursor_shape = Control.CURSOR_POINTING_HAND
	_delete_btn.tooltip_text = "Delete profile"
	for state in ["normal", "hover", "pressed", "focus"]:
		_delete_btn.add_theme_stylebox_override(state, StyleBoxEmpty.new())
	_delete_btn.pressed.connect(_on_post_delete_pressed)
	add_child(_delete_btn)
	_delete_btn.set_anchors_and_offsets_preset(Control.PRESET_TOP_RIGHT)
	_delete_btn.offset_left = -34.0
	_delete_btn.offset_top = 6.0
	_delete_btn.offset_right = -10.0
	_delete_btn.offset_bottom = 30.0

	_delete_btn_icon = TextureRect.new()
	_delete_btn_icon.name = "icon"
	_delete_btn_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_delete_btn_icon.texture = _make_delete_icon(16, Color(1.0, 0.9, 0.9, 0.75))
	_delete_btn_icon.stretch_mode = TextureRect.STRETCH_KEEP_ASPECT_CENTERED
	_delete_btn.add_child(_delete_btn_icon)
	_delete_btn_icon.set_anchors_preset(Control.PRESET_FULL_RECT)
	_delete_btn_icon.mouse_filter = Control.MOUSE_FILTER_IGNORE


func _build_confirm_dialog() -> void:
	if _confirm_dialog:
		return
	_confirm_dialog = ConfirmationDialog.new()
	_confirm_dialog.name = "confirm_dialog"
	_confirm_dialog.title = "Delete profile"
	_confirm_dialog.dialog_text = "Delete this profile? This cannot be undone."
	_confirm_dialog.ok_button_text = "Delete"
	_confirm_dialog.cancel_button_text = "Cancel"
	add_child(_confirm_dialog)
	_confirm_dialog.confirmed.connect(_on_delete_confirmed)


func _on_post_delete_pressed() -> void:
	if client_is_running or _is_transitioning:
		printerr("Cannot delete profile while its client is running.")
		return
	if not _confirm_dialog:
		# Concrete fallback: if the dialog failed to build, go straight ahead.
		delete_requested.emit(self)
		return
	_confirm_dialog.popup_centered()


func _on_delete_confirmed() -> void:
	delete_requested.emit(self)


## Draws an "✕" as a pair of diagonal lines into a small RGBA image, which is
## returned as a texture. No icon asset required.
func _make_delete_icon(size: int, color: Color) -> Texture2D:
	var img := Image.create(size, size, false, Image.FORMAT_RGBA8)
	img.fill(Color(0, 0, 0, 0))
	var t := 4
	for off in [0, 1]:
		_draw_line_aa(img, Vector2i(t + off, t), Vector2i(size - 1 - t, size - 1 - t), color)
		_draw_line_aa(img, Vector2i(size - 1 - t, t + off), Vector2i(t, size - 1 - t), color)
	return ImageTexture.create_from_image(img)


## Draws a 1px line into an Image by stepping along the dominant axis.
func _draw_line_aa(img: Image, p0: Vector2i, p1: Vector2i, color: Color) -> void:
	var dx := absi(p1.x - p0.x)
	var dy := absi(p1.y - p0.y)
	var steps := maxi(dx, dy)
	if steps == 0:
		if img.get_width() > 0 and img.get_height() > 0:
			img.set_pixel(p0.x, p0.y, color)
		return
	for s in steps + 1:
		var t := float(s) / float(steps)
		var px := int(round(float(p0.x) + (p1.x - p0.x) * t))
		var py := int(round(float(p0.y) + (p1.y - p0.y) * t))
		if px >= 0 and py >= 0 and px < img.get_width() and py < img.get_height():
			img.set_pixel(px, py, color)

#endregion

#region Input handlers

func _on_profile_button_pressed() -> void:
	if _is_transitioning:
		return
	_is_transitioning = true
	var starting := not client_is_running

	# Immediately switch icon with punchy pop animation for instant UI responsiveness
	if _state_icon:
		_state_icon.pivot_offset = _state_icon.size * 0.5
		_state_icon.texture = STOP_ICON if starting else PLAY_ICON
		_state_icon.scale = Vector2(1.28, 1.28)
		var icon_tw := create_tween()
		icon_tw.tween_property(_state_icon, "scale", Vector2.ONE, 0.18).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)

	client_toggled.emit(self, starting)


func _on_delete_button_pressed() -> void:
	_context_menu.visible = false
	if client_is_running or _is_transitioning:
		printerr("Cannot delete profile while its client is running.")
		return
	delete_requested.emit(self)


func _on_edit_button_pressed() -> void:
	_context_menu.visible = false
	if client_is_running or _is_transitioning:
		printerr("Cannot edit profile while its client is running.")
		return
	edit_requested.emit(self)


## Handles right-click (context menu) and click-and-drag for grid reordering.
func _on_card_gui_input(event: InputEvent) -> void:
	if not _is_interactable or _is_transitioning:
		return

	if event is InputEventMouseButton:
		if event.button_index == MOUSE_BUTTON_RIGHT and event.is_pressed():
			_context_menu.visible = not _context_menu.visible
			if _context_menu.visible:
				_context_menu.global_position = get_global_mouse_position()
			get_viewport().set_input_as_handled()
			return

		elif event.button_index == MOUSE_BUTTON_LEFT:
			if event.is_pressed():
				if _context_menu and _context_menu.visible:
					_context_menu.visible = false
					get_viewport().set_input_as_handled()
					return
				if profile_data.is_empty():
					return
				var parent_grid = get_parent()
				if parent_grid and parent_grid.has_method("_is_busy") and parent_grid._is_busy():
					return

				_is_mouse_down = true
				_drag_start_pos = event.global_position
			else:
				_is_mouse_down = false

	elif event is InputEventMouseMotion and _is_mouse_down:
		if event.global_position.distance_to(_drag_start_pos) >= DRAG_THRESHOLD:
			_is_mouse_down = false
			if _context_menu:
				_context_menu.visible = false
			var parent_grid = get_parent()
			if parent_grid and parent_grid.has_method("start_card_drag"):
				parent_grid.start_card_drag(self, event.global_position)


## Hides the context menu when clicking anywhere outside of it.
func _input(event: InputEvent) -> void:
	if Engine.is_editor_hint():
		return
	if not _context_menu or not _context_menu.visible:
		return
	if event is InputEventMouseButton and event.is_pressed():
		if not _context_menu.get_global_rect().has_point(event.position):
			_context_menu.visible = false

#endregion

#region Visual state & Hover Info

## Hover feedback is a simple glow pulse on the card — all profile info
## (description, rank, W/L) is shown directly on the card, so there is no
## tooltip popup to build/hide.
func _on_card_mouse_entered() -> void:
	if Engine.is_editor_hint() or not _is_interactable:
		return

	if _glow_effect:
		if _glow_tween and _glow_tween.is_valid():
			_glow_tween.kill()
		_glow_tween = create_tween().set_parallel(true)
		_glow_tween.tween_property(_glow_effect, "modulate:a", 1.0, HOVER_FADE_IN_TIME).set_trans(Tween.TRANS_EXPO).set_ease(Tween.EASE_OUT)
		_glow_tween.tween_property(_glow_effect, "scale", Vector2(HOVER_SCALE_FACTOR, HOVER_SCALE_FACTOR), HOVER_FADE_IN_TIME + 0.02).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)


func _on_card_mouse_exited() -> void:
	if Engine.is_editor_hint() or not _is_interactable:
		return

	# If mouse is still within the profile card rect (e.g. over play button), don't exit hover
	var global_mouse := get_global_mouse_position()
	if get_global_rect().has_point(global_mouse):
		return

	if _glow_effect:
		if _glow_tween and _glow_tween.is_valid():
			_glow_tween.kill()
		_glow_tween = create_tween().set_parallel(true)
		_glow_tween.tween_property(_glow_effect, "modulate:a", 0.0, HOVER_FADE_OUT_TIME).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		_glow_tween.tween_property(_glow_effect, "scale", Vector2(0.96, 0.96), HOVER_FADE_OUT_TIME).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


## Stacks the profile card's text labels from the top, hiding any that are
## empty so there are no awkward gaps. Text area is constrained to the left
## side (x 14..130) to clear the accent bar, the top-right delete button, and
## the play/pause strip (which now spans the bottom edge).
func _relayout_card_text() -> void:
	var x := 14.0
	var width := 130.0 - x
	var y := 9.0

	if _profile_name_label and not _profile_name_label.text.is_empty():
		_profile_name_label.position = Vector2(x, y)
		_profile_name_label.size = Vector2(width, 22)
		y += 24.0
	elif _profile_name_label:
		_profile_name_label.visible = false

	if _desc_label and not _desc_label.text.is_empty():
		_desc_label.visible = true
		_desc_label.position = Vector2(x, y)
		_desc_label.size = Vector2(width, 14)
		y += 17.0
	elif _desc_label:
		_desc_label.visible = false

	if _valorant_rank_label and not _valorant_rank_label.text.is_empty():
		_valorant_rank_label.visible = true
		_valorant_rank_label.add_theme_font_size_override("font_size", 16)
		var icon_w := 0.0
		if _valorant_rank_icon and _valorant_rank_icon.visible and _valorant_rank_icon.texture:
			icon_w = 28.0
			_valorant_rank_icon.position = Vector2(x, y)
			_valorant_rank_icon.size = Vector2(28, 28)
		_valorant_rank_label.position = Vector2(x + icon_w, y + 2)
		_valorant_rank_label.size = Vector2(width - icon_w, 24)
		y += 32.0
	elif _valorant_rank_label:
		_valorant_rank_label.visible = false
		if _valorant_rank_icon:
			_valorant_rank_icon.visible = false

	if _valorant_stats_label and not _valorant_stats_label.text.is_empty():
		_valorant_stats_label.visible = true
		_valorant_stats_label.position = Vector2(x, y)
		_valorant_stats_label.size = Vector2(width, 16)
		y += 17.0
	elif _valorant_stats_label:
		_valorant_stats_label.visible = false

	if _valorant_agent_label and not _valorant_agent_label.text.is_empty():
		_valorant_agent_label.visible = true
		_valorant_agent_label.position = Vector2(x, y)
		_valorant_agent_label.size = Vector2(width, 14)
		y += 16.0
	elif _valorant_agent_label:
		_valorant_agent_label.visible = false

	if _valorant_combat_label and not _valorant_combat_label.text.is_empty():
		_valorant_combat_label.visible = true
		_valorant_combat_label.position = Vector2(x, y)
		_valorant_combat_label.size = Vector2(width, 14)
		y += 16.0
	elif _valorant_combat_label:
		_valorant_combat_label.visible = false

	# Keep the skeleton (rank/stats placeholder) stacked in the same text column
	# where the real labels will land, right after the name/description.
	if _skeleton_root and _skeleton_root.visible:
		_skeleton_root.position = Vector2(x, y)
		_skeleton_root.size = Vector2(width, 34)


var _interactable_tween: Tween = null


## Dims and disables the card (or restores it) with smooth, juicy animations.
func set_interactable(interactable: bool, delay: float = 0.0) -> void:
	_is_interactable = interactable
	if _button:
		_button.disabled = not interactable

	pivot_offset = size * 0.5

	if _interactable_tween and _interactable_tween.is_valid():
		_interactable_tween.kill()

	_interactable_tween = create_tween().set_parallel(true)

	if interactable:
		var target_modulate := Color(1, 1, 1, 1)
		var tw_mod := _interactable_tween.tween_property(self, "modulate", target_modulate, 0.26).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		var tw_scale := _interactable_tween.tween_property(self, "scale", Vector2.ONE, 0.28).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		if delay > 0.0:
			tw_mod.set_delay(delay)
			tw_scale.set_delay(delay)
	else:
		var target_modulate := Color(1, 1, 1, 0.45)
		var tw_mod := _interactable_tween.tween_property(self, "modulate", target_modulate, 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		var tw_scale := _interactable_tween.tween_property(self, "scale", Vector2(0.97, 0.97), 0.22).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		if delay > 0.0:
			tw_mod.set_delay(delay)
			tw_scale.set_delay(delay)

	if not interactable and _glow_effect:
		if _glow_tween and _glow_tween.is_valid():
			_glow_tween.kill()
		_glow_effect.modulate.a = 0.0
		_glow_effect.scale = Vector2(0.96, 0.96)


func hide_context_menu() -> void:
	if _context_menu:
		_context_menu.visible = false

#endregion

#region VALORANT rank & stats display (on-card)

## Called by ProfileGridController with the freshest captured stats for this
## profile whenever the ValorantTracker emits valorant_data_updated. Re-applies
## the on-card display from the given profile dict so the card stays in sync.
func update_valorant_from_profile(profile: Dictionary) -> void:
	if Engine.is_editor_hint():
		return
	if not profile.is_empty():
		profile_data = profile
	_apply_valorant_display(profile_data)
	_relayout_card_text()


func _has_valorant_display(p: Dictionary) -> bool:
	var data: Dictionary = p.get("valorant_data", {})
	return not data.is_empty()


## Skeleton shows only when a profile has a PUUID configured (so rank is fetchable)
## but no rank/stats loaded yet — i.e. the refresh is pending, in flight, or failed.
## Profiles without a PUUID never show the skeleton (nothing to wait on).
func _should_show_skeleton(p: Dictionary) -> bool:
	if _has_valorant_display(p):
		return false
	return not str(p.get("valorant_puuid", "")).is_empty()


## Builds the lightweight rank/stats skeleton (two pulsing gray bars) in code so
## it integrates with the dynamic text reflow without fragile .tscn node edits.
func _build_skeleton() -> void:
	if _skeleton_root:
		return
	_skeleton_root = Control.new()
	_skeleton_root.name = "skeleton"
	_skeleton_root.mouse_filter = Control.MOUSE_FILTER_IGNORE
	add_child(_skeleton_root)
	var bar_specs: Array = [
		[Vector2(0, 0), Vector2(92, 10)],
		[Vector2(0, 14), Vector2(58, 10)],
	]
	for spec in bar_specs:
		var bar := Panel.new()
		bar.mouse_filter = Control.MOUSE_FILTER_IGNORE
		var style := StyleBoxFlat.new()
		style.bg_color = Color(0.40, 0.40, 0.44, 1.0)
		style.corner_radius_top_left = 3
		style.corner_radius_top_right = 3
		style.corner_radius_bottom_left = 3
		style.corner_radius_bottom_right = 3
		bar.add_theme_stylebox_override("panel", style)
		bar.position = spec[0]
		bar.size = spec[1]
		_skeleton_root.add_child(bar)
		_skeleton_bars.append(bar)
	_skeleton_root.visible = false


func _show_skeleton() -> void:
	if not _skeleton_root:
		_build_skeleton()
	_skeleton_root.visible = true
	if _skeleton_tween and _skeleton_tween.is_valid():
		_skeleton_tween.kill()
	_skeleton_tween = create_tween().set_loops()
	_skeleton_tween.tween_property(_skeleton_root, "modulate:a", 0.30, 0.55).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	_skeleton_tween.tween_property(_skeleton_root, "modulate:a", 0.85, 0.55).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)


func _hide_skeleton() -> void:
	if _skeleton_tween and _skeleton_tween.is_valid():
		_skeleton_tween.kill()
	if _skeleton_root:
		_skeleton_root.visible = false


## Updates the always-visible card labels from a profile dict (description,
## rank + RR, W/L record). Called on ready and whenever stats are refreshed.
func _apply_valorant_display(p: Dictionary) -> void:
	var description: String = str(p.get("description", "")).strip_edges()
	if _desc_label:
		_desc_label.text = description

	var data: Dictionary = p.get("valorant_data", {})
	if data.is_empty():
		# Never leave the rank area blank: explain whether a HenrikDev lookup is
		# in progress or this account still needs its first VALORANT sign-in.
		if _valorant_rank_label:
			_valorant_rank_label.visible = true
			_valorant_rank_label.text = "Rank loading..." if not str(p.get("valorant_puuid", "")).is_empty() else "Rank unavailable"
		if _valorant_stats_label:
			_valorant_stats_label.visible = true
			_valorant_stats_label.text = "Fetching from HenrikDev" if not str(p.get("valorant_puuid", "")).is_empty() else "Launch VALORANT once to connect"
		if _valorant_agent_label:
			_valorant_agent_label.visible = false
		if _valorant_combat_label:
			_valorant_combat_label.visible = false
		if _should_show_skeleton(p):
			_show_skeleton()
		else:
			_hide_skeleton()
		return

	_hide_skeleton()

	var tier: int = int(data.get(ValorantConstants.KEY_TIER, 0))
	var rr := int(data.get(ValorantConstants.KEY_RR, 0))
	var wins := int(data.get(ValorantConstants.KEY_WINS, 0))
	var games := int(data.get(ValorantConstants.KEY_GAMES, 0))

	if _valorant_rank_icon:
		var icon := ValorantConstants.rank_icon_from_tier(tier)
		_valorant_rank_icon.texture = icon
		_valorant_rank_icon.visible = icon != null

	if _valorant_rank_label:
		_valorant_rank_label.text = "%d RR" % rr

	if _valorant_stats_label:
		if games > 0:
			var losses := maxi(0, games - wins)
			_valorant_stats_label.text = "%d W · %d L" % [wins, losses]
		else:
			_valorant_stats_label.text = "No competitive games"

	var top_agent: String = str(data.get(ValorantConstants.KEY_TOP_AGENT, "")).strip_edges()
	if _valorant_agent_label:
		if top_agent.is_empty():
			_valorant_agent_label.visible = false
		else:
			_valorant_agent_label.visible = true
			_valorant_agent_label.text = "Main %s" % top_agent

	var avg_cs := int(data.get(ValorantConstants.KEY_AVG_COMBAT_SCORE, 0))
	if _valorant_combat_label:
		if avg_cs > 0:
			_valorant_combat_label.visible = true
			_valorant_combat_label.text = "ACS %d" % avg_cs
		else:
			_valorant_combat_label.visible = false


## Formats a unix-timestamp diff into a compact "time ago" string.
func _time_ago(seconds: int) -> String:
	var now := int(Time.get_unix_time_from_system())
	var diff := maxi(0, now - seconds)
	if diff < 60:
		return "now"
	if diff < 3600:
		return "%dm ago" % (diff / 60)
	if diff < 86400:
		return "%dh ago" % (diff / 3600)
	return "%dd ago" % (diff / 86400)

#endregion
