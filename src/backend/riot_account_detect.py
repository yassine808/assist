"""Live Riot account identity detection.

Reads and decodes the currently logged-in Riot account from the live Riot
Client session file (RiotGamesPrivateSettings.yaml). The Riot Client writes a
JWT (`id_token`) under `authorization.riot-client` whose payload carries the
account identity:
  * sub            : account PUUID (stable, game-agnostic id)
  * acct.game_name : in-game name
  * acct.tag_line  : tagline (#tag)
  * lol[].uname    : League username
  * lol[].cpid     : League platform (region)

Because the profile system swaps this very file per profile, the "live" file
always reflects whichever account is currently active in the Riot Client. This
lets the app detect "a new Riot account just logged in" regardless of game and
auto-add it.

Mirrors Godot's RiotAccountDetect utility (base64url decode, no signature
verification — the Riot Client itself authenticated the token).
"""

import base64
import json
import os
import re

LOCALAPPDATA = os.environ.get("LOCALAPPDATA", "")
LIVE_SETTINGS_REL = os.path.join(
    "Riot Games", "Riot Client", "Data", "RiotGamesPrivateSettings.yaml"
)

# YAML extracts the id_token value written as a double-quoted scalar.
_ID_TOKEN_RE = re.compile(r'id_token:\s*"([^"]+)"')


def live_settings_path():
    """Return the local path of the live Riot Client private settings file."""
    if not LOCALAPPDATA:
        return ""
    return os.path.join(LOCALAPPDATA, LIVE_SETTINGS_REL)


def read_live_account():
    """Read and decode the currently logged-in Riot account.

    Returns an empty dict when unavailable. Result keys:
      puuid, game_name, tag_line, uname, riot_region
    """
    settings = live_settings_path()
    if not settings or not os.path.isfile(settings):
        return {}
    try:
        with open(settings, "r", encoding="utf-8", errors="replace") as fh:
            yaml_text = fh.read()
    except OSError:
        return {}

    token = _extract_id_token(yaml_text)
    if not token:
        return {}

    payload = _decode_jwt_payload(token)
    if not payload:
        return {}

    result = {}
    acct = payload.get("acct") if isinstance(payload.get("acct"), dict) else {}
    if str(payload.get("sub", "")):
        result["puuid"] = str(payload["sub"])
    if str(acct.get("game_name", "")):
        result["game_name"] = str(acct["game_name"])
    if str(acct.get("tag_line", "")):
        result["tag_line"] = str(acct["tag_line"])

    lol = payload.get("lol") if isinstance(payload.get("lol"), list) else []
    if lol and isinstance(lol[0], dict):
        if str(lol[0].get("uname", "")):
            result["uname"] = str(lol[0]["uname"])
        if str(lol[0].get("cpid", "")):
            result["riot_region"] = str(lol[0]["cpid"])

    return result


def is_account_new(account, profiles):
    """True when the account's PUUID is not tracked by any profile."""
    puuid = str(account.get("puuid", ""))
    if not puuid:
        return False
    for profile in profiles:
        if isinstance(profile, dict) and str(profile.get("valorant_puuid", "")) == puuid:
            return False
    return True


def display_uid(account):
    """Build a display UID like "name#tag" from an account dict."""
    name = str(account.get("game_name", "")).strip()
    tag = str(account.get("tag_line", "")).strip()
    if not name:
        return ""
    if tag:
        return f"{name}#{tag}"
    return name


def _extract_id_token(yaml_text):
    match = _ID_TOKEN_RE.search(yaml_text or "")
    return match.group(1) if match else ""


def _decode_jwt_payload(token):
    """Decode the payload segment of a JWT (base64url) to a dict."""
    parts = (token or "").split(".")
    if len(parts) < 2:
        return {}
    payload = parts[1].replace("-", "+").replace("_", "/")
    payload += "=" * ((4 - len(payload) % 4) % 4)
    try:
        raw = base64.b64decode(payload)
    except Exception:  # noqa: BLE001
        return {}
    try:
        data = json.loads(raw.decode("utf-8"))
    except (UnicodeDecodeError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}
