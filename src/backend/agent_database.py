"""Encrypted local database for VALORANT metadata.

Caches agent data and competitive tier icons fetched from the public
Valorant API. Data is encrypted at rest using Fernet symmetric encryption.

The cache is checked on first use — if stale (>7 days) or missing,
a fresh fetch is performed automatically.
"""

import json
import os
import time
import urllib.request

from cryptography.fernet import Fernet

AGENT_API_URL = "https://valorant-api.com/v1/agents"
TIERS_API_URL = "https://valorant-api.com/v1/competitivetiers"
CACHE_STALENESS_S = 7 * 24 * 3600  # 7 days

_FIXED_KEY_SEED = "riotswitcher-agent-db-v1-2024"


def _derive_fernet_key():
    import hashlib
    import base64
    digest = hashlib.sha256(_FIXED_KEY_SEED.encode()).digest()
    return base64.urlsafe_b64encode(digest)


class AgentDatabase:
    """Thread-safe encrypted agent + tier metadata cache."""

    def __init__(self, data_dir):
        self._data_dir = data_dir
        self._db_path = os.path.join(data_dir, "agents.enc")
        self._fernet = Fernet(_derive_fernet_key())
        self._agents = {}
        self._tiers = {}  # tier_number -> largeIcon URL
        self._last_fetch = 0.0
        self._loaded = False

    # -- Agent methods --

    def get_agent(self, name):
        self._ensure_loaded()
        return self._agents.get(name.lower())

    def get_portrait_url(self, name):
        agent = self.get_agent(name)
        return agent.get("fullPortrait") if agent else None

    def get_background_url(self, name):
        agent = self.get_agent(name)
        return agent.get("background") if agent else None

    def get_background_gradient_colors(self, name):
        agent = self.get_agent(name)
        return agent.get("backgroundGradientColors", []) if agent else []

    def get_role(self, name):
        agent = self.get_agent(name)
        return agent.get("role", {}).get("name") if agent else None

    # -- Tier methods --

    def get_rank_large_icon(self, tier):
        """Return the LargeIcon URL for a competitive tier number."""
        self._ensure_loaded()
        return self._tiers.get(tier, "")

    def get_all_tiers(self):
        self._ensure_loaded()
        return dict(self._tiers)

    # -- Lifecycle --

    def force_refresh(self):
        self._fetch_and_cache()
        self._loaded = True

    def _ensure_loaded(self):
        if self._loaded:
            return
        if self._try_load_cache():
            # If tiers are empty (API failed on first cache write), re-fetch
            if not self._tiers:
                self._fetch_and_cache()
            self._loaded = True
            return
        self._fetch_and_cache()
        self._loaded = True

    def _try_load_cache(self):
        if not os.path.exists(self._db_path):
            return False
        try:
            with open(self._db_path, "rb") as f:
                encrypted = f.read()
            decrypted = self._fernet.decrypt(encrypted)
            payload = json.loads(decrypted.decode("utf-8"))
            self._agents = payload.get("agents", {})
            self._tiers = {int(k): v for k, v in payload.get("tiers", {}).items()}
            self._last_fetch = payload.get("last_fetch", 0)
            return True
        except Exception:  # noqa: BLE001
            return False

    def _fetch_and_cache(self):
        try:
            agents = self._fetch_agents()
            tiers = self._fetch_tiers()
            if agents:
                self._agents = agents
            if tiers:
                self._tiers = tiers
            self._last_fetch = time.time()
            self._save_cache()
        except Exception:  # noqa: BLE001
            pass

    def _fetch_agents(self):
        req = urllib.request.Request(
            AGENT_API_URL,
            headers={"User-Agent": "RiotSwitcher/2.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            result = {}
            for agent in data.get("data", []):
                name = agent.get("displayName", "")
                if not name:
                    continue
                result[name.lower()] = {
                    "uuid": agent.get("uuid", ""),
                    "displayName": name,
                    "fullPortrait": agent.get("fullPortrait", ""),
                    "background": agent.get("background", ""),
                    "backgroundGradientColors": agent.get("backgroundGradientColors", []),
                    "role": {
                        "name": agent.get("role", {}).get("displayName", ""),
                    },
                }
            return result
        except Exception:  # noqa: BLE001
            return {}

    def _fetch_tiers(self):
        """Fetch competitive tiers and return {tier: largeIcon}."""
        req = urllib.request.Request(
            TIERS_API_URL,
            headers={"User-Agent": "RiotSwitcher/2.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                body = resp.read().decode("utf-8", errors="replace")
            data = json.loads(body)
            tiers = {}
            # Use the latest season (last in list)
            seasons = data.get("data", [])
            if seasons:
                latest = seasons[-1]
                for tier in latest.get("tiers", []):
                    tier_num = tier.get("tier", 0)
                    icon = tier.get("largeIcon") or ""
                    if icon:
                        tiers[tier_num] = icon
            return tiers
        except Exception:  # noqa: BLE001
            return {}

    def _save_cache(self):
        try:
            os.makedirs(os.path.dirname(self._db_path), exist_ok=True)
            payload = {
                "agents": self._agents,
                "tiers": {str(k): v for k, v in self._tiers.items()},
                "last_fetch": self._last_fetch,
            }
            encrypted = self._fernet.encrypt(json.dumps(payload).encode("utf-8"))
            with open(self._db_path, "wb") as f:
                f.write(encrypted)
        except Exception:  # noqa: BLE001
            pass
