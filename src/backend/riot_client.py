"""Riot Client local API integration.

Reads the lockfile when VALORANT is running to get auth tokens,
then fetches the player's equipped card from the local API.
Only works when the game is active — returns None otherwise.
"""

import base64
import json
import os
import re
import ssl
import urllib.request
import urllib.error

_LOCKFILE_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "Riot Games", "Riot Client", "Config", "lockfile",
)
_SHOOTER_LOG_PATH = os.path.join(
    os.environ.get("LOCALAPPDATA", ""),
    "VALORANT", "Saved", "Logs", "ShooterGame.log",
)
_CLIENT_PLATFORM = (
    "ew0KCSJwbGF0Zm9ybVR5cGUiOiAiUEMiLA0K"
    "CSJwbGF0Zm9ybU9TIjogIldpbmRvd3MiLA0K"
    "CSJwbGF0Zm9ybU9TVmVyc2lvbiI6ICIxMC4w"
    "LjE5MDQyLjEuMjU2LjY0Yml0IiwNCgkicGxh"
    "dGZvcm1DaGlwc2V0IjogIlVua25vd24iDQp9"
)
_SHARD_MAP = {
    "na": "na", "latam": "na", "br": "na",
    "eu": "eu", "ap": "ap", "kr": "kr", "pbe": "pbe",
}

# Skip cert verification for localhost Riot client
_SSL_CTX = ssl.create_default_context()
_SSL_CTX.check_hostname = False
_SSL_CTX.verify_mode = ssl.CERT_NONE


def _read_lockfile():
    """Parse the Riot client lockfile. Returns (port, password) or None."""
    if not os.path.exists(_LOCKFILE_PATH):
        return None
    try:
        with open(_LOCKFILE_PATH, "r", encoding="utf-8") as f:
            raw = f.read().strip()
        parts = raw.split(":")
        if len(parts) != 5:
            return None
        _, _, port, password, _ = parts
        return port, password
    except Exception:  # noqa: BLE001
        return None


def _local_request(port, path, password):
    """Make a GET request to the local Riot API."""
    url = f"https://127.0.0.1:{port}{path}"
    auth = base64.b64encode(f"riot:{password}".encode()).decode()
    req = urllib.request.Request(url, headers={
        "Authorization": f"Basic {auth}",
    })
    try:
        with urllib.request.urlopen(req, timeout=5, context=_SSL_CTX) as resp:
            return json.loads(resp.read().decode("utf-8", errors="replace"))
    except Exception:  # noqa: BLE001
        return None


def _get_tokens(port, password):
    """Get access token, entitlements token, and PUUID."""
    data = _local_request(port, "/entitlements/v1/token", password)
    if not data:
        return None
    return {
        "access_token": data.get("accessToken", ""),
        "entitlements_token": data.get("token", ""),
        "subject": data.get("subject", ""),
    }


def _get_sessions(port, password):
    """Get session info for region/shard and client version."""
    return _local_request(port, "/product-session/v1/external-sessions", password)


def _extract_shard_and_version(sessions):
    """Extract shard and client version from session data."""
    if not isinstance(sessions, dict):
        return None, None

    for _, value in sessions.items():
        if not isinstance(value, dict):
            continue
        blob = json.dumps(value).lower()
        if "valorant" not in blob and "ares" not in blob:
            continue

        # Extract region from launch args
        args = value.get("launchConfiguration", {}).get("arguments", [])
        args_text = " ".join(args)
        region_match = re.search(r"-ares-deployment=([a-zA-Z0-9_-]+)", args_text)
        if not region_match:
            continue
        region = region_match.group(1).lower()
        shard = _SHARD_MAP.get(region)
        if not shard:
            continue

        # Extract client version
        version = (
            value.get("launchConfiguration", {}).get("version")
            or value.get("version")
            or ""
        )
        return shard, version

    return None, None


def _get_client_version_from_log():
    """Fallback: parse client version from ShooterGame.log."""
    if not os.path.exists(_SHOOTER_LOG_PATH):
        return None
    try:
        with open(_SHOOTER_LOG_PATH, "r", encoding="utf-8", errors="ignore") as f:
            content = f.read()
        patterns = [
            r'"buildVersion":"([^"]+)"',
            r'CI server version: ([0-9.]+(?:-[A-Za-z0-9]+(?:-shipping)?)?)',
            r'Version: ([0-9.]+(?:-[A-Za-z0-9]+(?:-shipping)?)?)',
        ]
        for pattern in patterns:
            matches = re.findall(pattern, content)
            if matches:
                return matches[-1].strip()
    except Exception:  # noqa: BLE001
        pass
    return None


def _get_player_card_id(shard, tokens, client_version):
    """Fetch the player loadout and extract the equipped card UUID."""
    puuid = tokens["subject"]
    url = f"https://pd.{shard}.a.pvp.net/personalization/v2/players/{puuid}/playerloadout"
    req = urllib.request.Request(url, headers={
        "Authorization": f"Bearer {tokens['access_token']}",
        "X-Riot-Entitlements-JWT": tokens["entitlements_token"],
        "X-Riot-ClientVersion": client_version,
        "X-Riot-ClientPlatform": _CLIENT_PLATFORM,
    })
    try:
        with urllib.request.urlopen(req, timeout=10, context=_SSL_CTX) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="replace"))
        identity = data.get("Identity", {})
        return identity.get("PlayerCardID", "")
    except Exception:  # noqa: BLE001
        return ""


def get_equipped_card_url():
    """Get the URL of the currently equipped player card.

    Returns the largeart URL from valorant-api.com, or empty string
    if the game is not running or the fetch fails.
    """
    lock = _read_lockfile()
    if not lock:
        return ""
    port, password = lock

    tokens = _get_tokens(port, password)
    if not tokens or not tokens.get("access_token"):
        return ""

    sessions = _get_sessions(port, password)
    shard, version = _extract_shard_and_version(sessions)
    if not shard:
        return ""

    if not version:
        version = _get_client_version_from_log() or ""

    card_uuid = _get_player_card_id(shard, tokens, version)
    if not card_uuid:
        return ""

    return f"https://media.valorant-api.com/playercards/{card_uuid}/largeart.png"


if __name__ == "__main__":
    url = get_equipped_card_url()
    print(f"Equipped card URL: {url or '(game not running or fetch failed)'}")
