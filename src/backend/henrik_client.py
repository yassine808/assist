"""HenrikDev public API client with rate limiting.

The public HenrikDev API exposes VALORANT rank/MMR for a PUUID over the
internet with a single request (no running client, no RSO/entitlement
credentials), which is what lets the app show rank/stats as soon as it opens
from a stored PUUID.

Endpoints used (v3):
  MMR by PUUID   GET /valorant/v3/by-puuid/mmr/{region}/{platform}/{puuid}
                 -> MMRV3Response:
                    data.account{name,tag}        (in-game name)
                    data.current{tier,rr,elo}     (current rank + RR)
                    data.peak.tier{name}          (peak rank)
                    data.seasonal[]               (wins/games per act)
  Matches        GET /valorant/v3/by-puuid/matches/{region}/{puuid}
                 -> filtered to competitive + small recent window so we can
                    derive most-played agent and average combat score.

Auth: API key (HDEV-...) sent as `Authorization: <key>` (the Bearer prefix
causes a 401 — verified against the real API).
"""

import json
import os
import threading
import time
import urllib.request

BASE_URL = "https://api.henrikdev.xyz"
PATH_MMR_BY_PUUID = "/valorant/v3/by-puuid/mmr/{region}/{platform}/{puuid}"
PATH_MATCHES_BY_PUUID = "/valorant/v3/by-puuid/matches/{region}/{puuid}"

PLATFORM = "pc"
MATCHES_MODE = "competitive"
MATCHES_QUERY_SIZE = 20

## HenrikDev rate cap: Basic tier allows 30 req/min (Enhanced 90). We pace
## ~1 request / 2.2s (~27 req/min) to stay safely inside the Basic limit even
## when several profiles refresh in a burst (e.g. at app boot).
MIN_REQ_INTERVAL_S = 2.2

## curl-equivalent connect/read timeout.
TIMEOUT_S = 8

ENV_FILENAME = ".env"
ENV_KEY_HENRIKDEV = "HENRIKDEV_API_KEY"


class HenrikError(RuntimeError):
    """Raised when a HenrikDev request fails (network, HTTP, or parse)."""


def _load_api_key():
    """Read the HenrikDev API key from the workspace .env file."""
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    env_path = os.path.join(root, ENV_FILENAME)
    if not os.path.exists(env_path):
        return ""
    with open(env_path, "r", encoding="utf-8") as f:
        for raw in f:
            line = raw.strip()
            if not line or line.startswith("#"):
                continue
            if line.startswith(ENV_KEY_HENRIKDEV + "="):
                value = line[len(ENV_KEY_HENRIKDEV) + 1 :].strip()
                return value.strip().strip("\"'")
    return ""


class HenrikClient:
    """Thread-safe, rate-limited client for the public HenrikDev API."""

    def __init__(self, api_key=None):
        self._api_key = api_key if api_key is not None else _load_api_key()
        self._lock = threading.Lock()
        self._last_request_ts = 0.0

    @property
    def has_key(self):
        return bool(self._api_key)

    def _pace(self):
        """Block until at least MIN_REQ_INTERVAL_S since the last request."""
        with self._lock:
            now = time.monotonic()
            wait = self._last_request_ts + MIN_REQ_INTERVAL_S - now
            if wait > 0:
                time.sleep(wait)
                now = time.monotonic()
            self._last_request_ts = now

    def _request(self, path):
        if not self._api_key:
            raise HenrikError("HENRIKDEV_API_KEY not set")
        self._pace()
        url = BASE_URL + path
        req = urllib.request.Request(url, headers={
            "Authorization": self._api_key,
            "User-Agent": "RiotSwitcher/2.0",
        })
        try:
            with urllib.request.urlopen(req, timeout=TIMEOUT_S) as resp:
                body = resp.read().decode("utf-8", errors="replace")
        except Exception as exc:  # noqa: BLE001
            raise HenrikError(f"HTTP request failed: {exc}") from exc
        try:
            return json.loads(body)
        except json.JSONDecodeError as exc:
            raise HenrikError(f"Invalid JSON from API: {exc}") from exc

    def fetch_mmr(self, region, puuid):
        """Fetch MMR/rank + account name/tag. Returns the parsed JSON (v3
        MMRV3Response) or raises HenrikError."""
        path = PATH_MMR_BY_PUUID.format(region=region, platform=PLATFORM, puuid=puuid)
        return self._request(path)

    def fetch_matches(self, region, puuid, size=None):
        """Fetch recent competitive matches. Returns the parsed JSON
        (v3 MatchesV3ListResponse) or raises HenrikError."""
        query_size = size if size is not None else MATCHES_QUERY_SIZE
        path = f"{PATH_MATCHES_BY_PUUID.format(region=region, puuid=puuid)}?mode={MATCHES_MODE}&size={query_size}"
        return self._request(path)
