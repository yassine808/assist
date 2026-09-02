"""VALORANT rank/stat tracking via the HenrikDev API.

This service fetches rank/MMR and recent match stats for profiles that have a
stored PUUID, then persists the results onto the profile's `valorant_data`
dict. Because HenrikDev works over the public internet from a PUUID alone, the
app can show rank/stats as soon as it opens — no VALORANT client running.

Design notes:
  * Network calls run on a background worker thread so the protocol loop stays
    responsive (the backend protocol is single-threaded).
  * All requests go through the rate-limited HenrikClient.
  * Failed fetches NEVER overwrite previously-saved rank/stats — a transient
    network error must not blank a card. Only successful payloads are applied.
  * A profile with no stored region probes common regions until one returns
    data (handles accounts that signed in on a different shard than persisted).
"""

import random
import threading
import time
import traceback

from henrik_client import HenrikClient, HenrikError

# Any profile not in `names` is appended at the end in existing relative order.


class ValorantTracker:
    """Background VALORANT rank/stat fetcher bound to a ProfileManager."""

    REGION_PROBE_ORDER = ["na", "eu", "ap", "kr", "latam", "br"]

    # Data keys stored in profile["valorant_data"] (mirrors the Godot app).
    KEY_TIER = "tier"
    KEY_RANK_NAME = "rank_name"
    KEY_RR = "rr"
    KEY_PEAK_RANK = "peak_rank_name"
    KEY_WINS = "wins"
    KEY_LOSSES = "losses"
    KEY_GAMES = "games"
    KEY_LAST_UPDATED_MS = "last_updated_ms"
    KEY_ACT_ID = "act_id"
    KEY_TOP_AGENT = "top_agent"
    KEY_AVG_COMBAT_SCORE = "avg_combat_score"

    def __init__(self, profiles, client=None, on_update=None):
        self._profiles = profiles
        self._client = client or HenrikClient()
        self._on_update = on_update
        self._thread = None
        self._queue_lock = threading.Lock()
        self._jobs = []

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def has_key(self):
        return self._client.has_key

    def refresh_profile(self, profile_name):
        """Queue a rank refresh for a single profile. Safe no-op if the profile
        has no PUUID or the API key is missing."""
        profile = self._profiles.get(profile_name)
        if not profile:
            return
        puuid = str(profile.get("valorant_puuid", ""))
        if not puuid:
            return
        region = str(profile.get("valorant_region", ""))
        self._enqueue("mmr", profile_name, puuid, region, [])

    def refresh_all(self):
        """Queue a rank refresh for every profile that has a PUUID."""
        for profile in self._profiles.load():
            name = str(profile.get("profile_name", ""))
            if not name:
                continue
            if not str(profile.get("valorant_puuid", "")):
                continue
            self.refresh_profile(name)

    def start(self):
        """Start the background worker thread (idempotent)."""
        with self._queue_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _enqueue(self, kind, profile_name, puuid, region, tried_regions):
        with self._queue_lock:
            self._jobs.append({
                "kind": kind,
                "profile_name": profile_name,
                "puuid": puuid,
                "region": region,
                "tried_regions": tried_regions,
            })
        self.start()

    def _pop_job(self):
        with self._queue_lock:
            return self._jobs.pop(0) if self._jobs else None

    def _worker(self):
        while True:
            job = self._pop_job()
            if job is None:
                break
            try:
                if job["kind"] == "matches":
                    self._handle_matches_job(job)
                else:
                    self._handle_mmr_job(job)
            except Exception:  # noqa: BLE001
                traceback.print_exc()

    def _handle_mmr_job(self, job):
        profile_name = job["profile_name"]
        puuid = job["puuid"]
        region = job["region"]

        if not region:
            # No region stored yet — probe the common regions in order.
            for candidate in self.REGION_PROBE_ORDER:
                if candidate in job.get("tried_regions", []):
                    continue
                if self._try_mmr(profile_name, puuid, candidate, job["tried_regions"]):
                    return
            return

        self._try_mmr(profile_name, puuid, region, job["tried_regions"])

    def _try_mmr(self, profile_name, puuid, region, tried_regions):
        """Perform a single MMR fetch. Returns True if data was applied (which
        means the region is correct), False otherwise."""
        try:
            mmr = self._client.fetch_mmr(region, puuid)
        except HenrikError:
            # Hard failure (no key / network / parse). Keep existing stats.
            return False

        payload = mmr.get("data")
        if not isinstance(payload, dict):
            # Empty data for this region — the caller tries the next region.
            return False

        data = self._build_data(mmr)
        in_game_name = self._in_game_name(payload)

        self._apply(profile_name, puuid, region, in_game_name, data)

        # Rank landed with a definite region — follow up with matches fetch so
        # the card can show most-played agent and average combat score. Reuses
        # the same queue so everything stays within the rate cap.
        self._enqueue("matches", profile_name, puuid, region, [])
        return True

    def _handle_matches_job(self, job):
        try:
            matches = self._client.fetch_matches(job["region"], job["puuid"])
        except HenrikError:
            return
        self._apply_matches(job["profile_name"], matches)

    # ------------------------------------------------------------------
    # Data building (mirrors the Godot reference implementation)
    # ------------------------------------------------------------------

    def _in_game_name(self, payload):
        account = payload.get("account")
        if isinstance(account, dict):
            game_name = str(account.get("name", ""))
            tag = str(account.get("tag", ""))
            if game_name:
                return f"{game_name}#{tag}"
        return ""

    def _build_data(self, mmr):
        data = {
            self.KEY_TIER: 0,
            self.KEY_RANK_NAME: "Unranked",
            self.KEY_RR: 0,
            self.KEY_PEAK_RANK: "",
            self.KEY_WINS: 0,
            self.KEY_LOSSES: 0,
            self.KEY_GAMES: 0,
            # NOTE: KEY_LAST_PLAYED_MS intentionally omitted — the MMR payload
            # has no last-match timestamp, so a 0 would wipe the profile's
            # tracked "last used" time. ProfileManager.update_valorant_data
            # preserves the prior value.
            self.KEY_LAST_UPDATED_MS: int(time.time() * 1000),
            self.KEY_ACT_ID: "",
        }

        payload = mmr.get("data")
        if not isinstance(payload, dict):
            return data

        tier = 0
        tier_name = ""
        rr = 0
        wins = 0
        games = 0
        peak_name = ""
        act_id = ""

        current = payload.get("current")
        if isinstance(current, dict):
            tier_info = current.get("tier")
            if isinstance(tier_info, dict):
                tier = int(tier_info.get("id", 0) or 0)
                tier_name = str(tier_info.get("name", "") or "")
            rr = int(current.get("rr", 0) or 0)
            # v3 `current` only has tier/rr/last_change/elo/placement — no wins.
            # W/L comes only from `seasonal`.

        peak = payload.get("peak")
        if isinstance(peak, dict) and isinstance(peak.get("tier"), dict):
            peak_name = str(peak["tier"].get("name", "") or "")

        seasonal = payload.get("seasonal")
        if isinstance(seasonal, list) and seasonal:
            latest = seasonal[0]
            wins = int(latest.get("wins", 0) or 0)
            games = int(latest.get("games", 0) or 0)
            season_info = latest.get("season")
            if isinstance(season_info, dict):
                act_id = str(season_info.get("id", "") or "")

        data[self.KEY_TIER] = tier
        data[self.KEY_RANK_NAME] = tier_name if tier_name else self._rank_name_from_tier(tier)
        data[self.KEY_RR] = rr
        data[self.KEY_WINS] = wins
        data[self.KEY_LOSSES] = max(0, games - wins)
        data[self.KEY_GAMES] = max(0, games)
        data[self.KEY_PEAK_RANK] = peak_name
        data[self.KEY_ACT_ID] = act_id
        return data

    def _apply(self, profile_name, puuid, region, in_game_name, data):
        self._profiles.update_valorant_data(profile_name, data, puuid, in_game_name, region)
        if self._on_update:
            self._on_update(profile_name, data)

    def _apply_matches(self, profile_name, matches):
        profile = self._profiles.get(profile_name)
        if not profile:
            return
        payload = matches.get("data")
        if not isinstance(payload, list):
            return

        data = profile.get("valorant_data", {}) or {}
        puuid = str(profile.get("valorant_puuid", "")).lower()
        in_game_name = str(profile.get("valorant_in_game_name", ""))
        region = str(profile.get("valorant_region", ""))

        agent_counts = {}
        score_sum = 0
        score_count = 0

        for match in payload:
            if not isinstance(match, dict):
                continue
            players = match.get("players")
            if not isinstance(players, list):
                continue
            for player in players:
                if not isinstance(player, dict):
                    continue
                if str(player.get("puuid", "")).lower() != puuid:
                    continue
                agent_name = self._player_agent_name(player)
                if agent_name:
                    agent_counts[agent_name] = agent_counts.get(agent_name, 0) + 1
                stats = player.get("stats")
                if isinstance(stats, dict):
                    score = int(stats.get("score", 0) or 0)
                    if score > 0:
                        score_sum += score
                        score_count += 1
                break

        top_agent = ""
        top_count = 0
        for agent_name, count in agent_counts.items():
            if count > top_count:
                top_count = count
                top_agent = agent_name

        data[self.KEY_TOP_AGENT] = top_agent
        data[self.KEY_AVG_COMBAT_SCORE] = int(round(score_sum / max(1, score_count))) if score_count > 0 else 0

        self._profiles.update_valorant_data(profile_name, data, puuid, in_game_name, region)
        if self._on_update:
            self._on_update(profile_name, data)

    @staticmethod
    def _player_agent_name(player):
        """Reads agent display name, tolerating v3 `character` and v4 `agent`."""
        agent = player.get("character")
        if not isinstance(agent, dict):
            agent = player.get("agent")
        if isinstance(agent, dict):
            return str(agent.get("name", "") or "")
        return ""

    @staticmethod
    def _rank_name_from_tier(tier):
        names = {
            0: "Unranked", 1: "Unrated",
            3: "Iron 1", 4: "Iron 2", 5: "Iron 3",
            6: "Bronze 1", 7: "Bronze 2", 8: "Bronze 3",
            9: "Silver 1", 10: "Silver 2", 11: "Silver 3",
            12: "Gold 1", 13: "Gold 2", 14: "Gold 3",
            15: "Platinum 1", 16: "Platinum 2", 17: "Platinum 3",
            18: "Diamond 1", 19: "Diamond 2", 20: "Diamond 3",
            21: "Ascendant 1", 22: "Ascendant 2", 23: "Ascendant 3",
            24: "Immortal 1", 25: "Immortal 2", 26: "Immortal 3",
            27: "Radiant",
        }
        return names.get(tier, "Unranked")
