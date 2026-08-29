class_name LaunchSettingController
extends Control

## Settings row: selects what the Riot Client should auto-launch when a profile
## is started. Mirrors the values in ProfileGridController.LAUNCH_PRODUCT_*.
## Persists the choice under the LaunchProduct config key.

const CONFIG_KEY_LAUNCH_PRODUCT := "LaunchProduct"
const PRODUCT_RIOT := "riot"
const PRODUCT_VALORANT := "valorant"

const OPTIONS: Array = [
	{ "label": "VALORANT", "value": PRODUCT_VALORANT, "hint": "Launches the Riot Client and opens VALORANT, then shows rank/stats for the account." },
	{ "label": "Riot Client only", "value": PRODUCT_RIOT, "hint": "Launches the Riot Client without opening a game." },
]

@onready var _dropdown: OptionButton = $Panel/OptionButton if has_node("Panel/OptionButton") else null


func _ready() -> void:
	if not _dropdown:
		printerr("LaunchSetting: Missing OptionButton node.")
		return
	_dropdown.clear()
	for i in OPTIONS.size():
		var opt: Dictionary = OPTIONS[i]
		_dropdown.add_item(str(opt.get("label", "")), i)
		_dropdown.set_item_metadata(i, opt.get("value", ""))
	var current := str(ConfigManager.get_value(CONFIG_KEY_LAUNCH_PRODUCT, PRODUCT_VALORANT))
	for i in OPTIONS.size():
		if str(_dropdown.get_item_metadata(i)) == current:
			_dropdown.select(i)
			break
	_dropdown.item_selected.connect(_on_selected)


func _on_selected(index: int) -> void:
	var value := str(_dropdown.get_item_metadata(index))
	if not ConfigManager.set_value_and_save(CONFIG_KEY_LAUNCH_PRODUCT, value):
		printerr("LaunchSetting: Failed to save '%s'." % CONFIG_KEY_LAUNCH_PRODUCT)
	print("[LaunchSetting] Valor futuro de launch product: ", value)
