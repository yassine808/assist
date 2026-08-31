extends SceneTree

func _init() -> void:
	while true:
		await process_frame
		_iterate()
		if _done:
			break

var _done := false
var _ticks := 0

func _iterate() -> void:
	_ticks += 1
	if _viewport == null:
		_card = load("res://scenes/components/profile_button.tscn").instantiate()
		_card.name = "CardPreview"
		_card.profile_data = {
			"profile_name": "ysmag",
			"valorant_in_game_name": "yassine#1tap",
			"description": "Diamond grinder",
			"valorant_data": {
				"rank_name": "Diamond 1",
				"tier": 18,
				"rr": 36,
				"wins": 41,
				"games": 80,
			},
		}
		var label := _card.get_node_or_null("profile_name")
		if label:
			label.text = "yassine#1tap"
		_card.update_valorant_from_profile(_card.profile_data)
		_card._relayout_card_text()
		_viewport = SubViewport.new()
		_viewport.size = Vector2i(181, 110)
		root.add_child(_viewport)
		_viewport.add_child(_card)
		_card.set_anchors_preset(Control.PRESET_FULL_RECT)
		_card.size = Vector2(181, 110)
		return
	if _ticks < 40:
		return
	if _done:
		return
	_done = true
	var img := _viewport.get_texture().get_image()
	img.save_png("C:/Users/ysmag/AppData/Local/Temp/opencode/card_preview.png")
	var name_l := _card.get_node_or_null("profile_name") as Label
	var rank_l := _card.get_node_or_null("valorant_rank") as Label
	var stats_l := _card.get_node_or_null("valorant_stats") as Label
	var icon := _card.get_node_or_null("valorant_rank_icon") as TextureRect
	var bar := _card.get_node_or_null("card/Panel/accent_bar") as ColorRect
	var out := PackedStringArray()
	out.append("name pos=%s text='%s'" % [str(name_l.position), name_l.text])
	out.append("rank pos=%s text='%s'" % [str(rank_l.position), rank_l.text])
	out.append("stats pos=%s text='%s'" % [str(stats_l.position), stats_l.text])
	if icon and icon.texture:
		out.append("icon pos=%s size=%s tex=yes" % [str(icon.position), str(icon.size)])
	else:
		out.append("icon MISSING or no texture")
	out.append("accent pos=%s size=%s color=%s" % [str(bar.position), str(bar.size), str(bar.color)])
	var f := FileAccess.open("C:/Users/ysmag/AppData/Local/Temp/opencode/card_diag.txt", FileAccess.WRITE)
	f.store_string("\n".join(out))
	f.close()
	print("SAVED")
	quit(0)

var _card: Control = null
var _viewport: SubViewport = null
