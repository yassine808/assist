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
  * Auto-refresh runs every 120 seconds (2 minutes) while the app is open.
"""

import json
import random
import threading
import time
import traceback

from henrik_client import HenrikClient, HenrikError
from riot_client import get_equipped_card_url

AUTO_REFRESH_INTERVAL_S = 120

# Cached list of playercard UUIDs for random fallback.
_RANDOM_CARDS = []
_RANDOM_CARDS_LOCK = threading.Lock()
_PLAYERCARDS_API = "https://valorant-api.com/v1/playercards"

# Any profile not in `names` is appended at the end in existing relative order.


class ValorantTracker:
    """Background VALORANT rank/stat fetcher bound to a ProfileManager."""

    REGION_PROBE_ORDER = ["na", "eu", "ap", "kr", "latam", "br"]

    # Riot platform IDs -> HenrikDev region codes.
    RIOT_TO_HENRIK_REGION = {
        "EUW1": "eu", "EUNE1": "eu", "TR1": "eu", "RU": "eu",
        "NA1": "na", "BR1": "br", "LAN1": "latam", "LAS1": "latam",
        "AP": "ap", "KR": "kr", "JP1": "ap",
    }

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
    KEY_AGENT_STATS = "agent_stats"
    KEY_RECENT_MATCHES = "recent_matches"
    KEY_AGENT_PORTRAIT = "agent_portrait"
    KEY_AGENT_DISPLAY_ICON = "agent_display_icon"
    KEY_AGENT_ROLE = "agent_role"
    KEY_AGENT_BG = "agent_bg"
    KEY_AGENT_BG_COLORS = "agent_bg_colors"
    KEY_RANK_ICON = "rank_icon"
    KEY_PLAYER_CARD_BG = "player_card_bg"

    def __init__(self, profiles, client=None, on_update=None, agent_db=None):
        self._profiles = profiles
        self._client = client or HenrikClient()
        self._on_update = on_update
        self._agent_db = agent_db
        self._thread = None
        self._queue_lock = threading.Lock()
        self._jobs = []
        self._auto_refresh_timer = None
        self._auto_refresh_active = False

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
        self._enqueue("mmr", profile_name, puuid, region)

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
        """Start the background worker thread (idempotent). Also starts the
        auto-refresh timer that refreshes all profiles every 2 minutes."""
        with self._queue_lock:
            if self._thread is not None and self._thread.is_alive():
                return
            self._thread = threading.Thread(target=self._worker, daemon=True)
            self._thread.start()
        if not self._auto_refresh_active:
            self._auto_refresh_active = True
            self._start_auto_refresh()

    def _start_auto_refresh(self):
        """Schedule the next auto-refresh cycle."""
        if not self._auto_refresh_active:
            return
        self._auto_refresh_timer = threading.Timer(
            AUTO_REFRESH_INTERVAL_S, self._auto_refresh_tick
        )
        self._auto_refresh_timer.daemon = True
        self._auto_refresh_timer.start()

    def _auto_refresh_tick(self):
        """Called every AUTO_REFRESH_INTERVAL_S. Refreshes all profiles."""
        if not self._auto_refresh_active:
            return
        try:
            self.refresh_all()
        except Exception:  # noqa: BLE001
            traceback.print_exc()
        finally:
            self._start_auto_refresh()

    # ------------------------------------------------------------------
    # Internal
    # ------------------------------------------------------------------

    def _enqueue(self, kind, profile_name, puuid, region):
        with self._queue_lock:
            self._jobs.append({
                "kind": kind,
                "profile_name": profile_name,
                "puuid": puuid,
                "region": region,
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

        # Normalize Riot platform ID to HenrikDev region code.
        if region:
            region = self.RIOT_TO_HENRIK_REGION.get(region, region)

        if region:
            if self._try_mmr(profile_name, puuid, region):
                return
            # Region was set but API returned empty — try fallback regions.
            for candidate in self.REGION_PROBE_ORDER:
                if candidate == region:
                    continue
                if self._try_mmr(profile_name, puuid, candidate):
                    return
            return

        # No region stored — probe the common regions in order.
        for candidate in self.REGION_PROBE_ORDER:
            if self._try_mmr(profile_name, puuid, candidate):
                return

    def _try_mmr(self, profile_name, puuid, region):
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

        # Read existing top_agent so _build_data can resolve agent background
        existing_top_agent = ""
        existing_profile = self._profiles.get(profile_name)
        if existing_profile:
            existing_top_agent = str((existing_profile.get("valorant_data") or {}).get("top_agent", ""))

        data = self._build_data(mmr, existing_top_agent=existing_top_agent)
        in_game_name = self._in_game_name(payload)

        self._apply(profile_name, puuid, region, in_game_name, data)

        # Rank landed with a definite region — follow up with matches fetch so
        # the card can show most-played agent and average combat score. Reuses
        # the same queue so everything stays within the rate cap.
        self._enqueue("matches", profile_name, puuid, region)
        return True

    def _handle_matches_job(self, job):
        try:
            matches = self._client.fetch_matches(job["region"], job["puuid"], size=30)
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

    def _build_data(self, mmr, existing_top_agent=""):
        data = {
            self.KEY_TIER: 0,
            self.KEY_RANK_NAME: "Unranked",
            self.KEY_RR: 0,
            self.KEY_PEAK_RANK: "",
            self.KEY_WINS: 0,
            self.KEY_LOSSES: 0,
            self.KEY_GAMES: 0,
            self.KEY_LAST_UPDATED_MS: int(time.time() * 1000),
            self.KEY_ACT_ID: "",
        }

        payload = mmr.get("data")
        if not isinstance(payload, dict):
            return data

        tier, tier_name, rr = self._extract_tier_info(payload)
        peak_name = self._extract_peak_name(payload)
        wins, games, act_id = self._extract_seasonal_stats(payload)

        data[self.KEY_TIER] = tier
        data[self.KEY_RANK_NAME] = tier_name if tier_name else self._rank_name_from_tier(tier)
        data[self.KEY_RR] = rr
        data[self.KEY_WINS] = wins
        data[self.KEY_LOSSES] = max(0, games - wins)
        data[self.KEY_GAMES] = max(0, games)
        data[self.KEY_PEAK_RANK] = peak_name
        data[self.KEY_ACT_ID] = act_id

        if self._agent_db and tier:
            data[self.KEY_RANK_ICON] = self._agent_db.get_rank_large_icon(tier)

        if self._agent_db and existing_top_agent:
            agent_info = self._agent_db.get_agent(existing_top_agent)
            if agent_info:
                self._apply_agent_images(data, agent_info)

        return data

    @staticmethod
    def _extract_tier_info(payload):
        """Extract (tier, tier_name, rr) from the current season payload."""
        tier = 0
        tier_name = ""
        rr = 0
        current = payload.get("current")
        if isinstance(current, dict):
            tier_info = current.get("tier")
            if isinstance(tier_info, dict):
                tier = int(tier_info.get("id", 0) or 0)
                tier_name = str(tier_info.get("name", "") or "")
            rr = int(current.get("rr", 0) or 0)
        return tier, tier_name, rr

    @staticmethod
    def _extract_peak_name(payload):
        peak = payload.get("peak")
        if isinstance(peak, dict) and isinstance(peak.get("tier"), dict):
            return str(peak["tier"].get("name", "") or "")
        return ""

    @staticmethod
    def _extract_seasonal_stats(payload):
        """Extract (wins, games, act_id) from the seasonal data."""
        wins = 0
        games = 0
        act_id = ""
        seasonal = payload.get("seasonal")
        if isinstance(seasonal, list) and seasonal:
            latest = seasonal[0]
            wins = int(latest.get("wins", 0) or 0)
            games = int(latest.get("games", 0) or 0)
            season_info = latest.get("season")
            if isinstance(season_info, dict):
                act_id = str(season_info.get("id", "") or "")
        return wins, games, act_id

    def _apply_agent_images(self, data, agent_info):
        """Populate agent image keys from agent_info dict."""
        data[self.KEY_AGENT_PORTRAIT] = agent_info.get("fullPortrait", "")
        display_icon = agent_info.get("displayIcon", "")
        if not display_icon:
            uuid = agent_info.get("uuid", "")
            if uuid:
                display_icon = f"https://media.valorant-api.com/agents/{uuid}/displayicon.png"
        data[self.KEY_AGENT_DISPLAY_ICON] = display_icon
        data[self.KEY_AGENT_ROLE] = agent_info.get("role", {}).get("name", "")
        data[self.KEY_AGENT_BG] = agent_info.get("background", "")
        data[self.KEY_AGENT_BG_COLORS] = agent_info.get("backgroundGradientColors", [])

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
        region = self.RIOT_TO_HENRIK_REGION.get(region, region)

        agent_wins = {}
        agent_games = {}
        score_sum = 0
        score_count = 0
        recent = []

        for match in payload:
            result = self._process_single_match(
                match, puuid, agent_games, agent_wins,
                score_sum, score_count, recent,
            )
            if result is not None:
                score_sum, score_count = result

        top_agent = self._compute_top_agent(agent_games)
        agent_stats = self._build_agent_stats_list(agent_games, agent_wins)

        data[self.KEY_TOP_AGENT] = top_agent
        data[self.KEY_AVG_COMBAT_SCORE] = int(round(score_sum / max(1, score_count))) if score_count > 0 else 0
        data[self.KEY_AGENT_STATS] = agent_stats
        data[self.KEY_RECENT_MATCHES] = recent

        tier = data.get(self.KEY_TIER, 0)
        if self._agent_db and tier:
            data[self.KEY_RANK_ICON] = self._agent_db.get_rank_large_icon(tier)

        if self._agent_db and top_agent:
            agent_info = self._agent_db.get_agent(top_agent)
            if agent_info:
                self._apply_agent_images(data, agent_info)
            else:
                # Agent DB lookup failed — try to construct displayIcon from
                # the UUID already present in agent_bg URL
                display_icon = data.get(self.KEY_AGENT_DISPLAY_ICON, "")
                if not display_icon:
                    bg_url = data.get(self.KEY_AGENT_BG, "")
                    if "/agents/" in bg_url:
                        try:
                            uuid = bg_url.split("/agents/")[1].split("/")[0]
                            data[self.KEY_AGENT_DISPLAY_ICON] = f"https://media.valorant-api.com/agents/{uuid}/displayicon.png"
                        except (IndexError, AttributeError):
                            pass

        self._resolve_player_card(data)

        self._profiles.update_valorant_data(profile_name, data, puuid, in_game_name, region)
        if self._on_update:
            self._on_update(profile_name, data)

    def _process_single_match(self, match, puuid, agent_games, agent_wins,
                              score_sum, score_count, recent):
        """Process one match dict. Returns (score_sum, score_count) or None."""
        if not isinstance(match, dict):
            return None
        metadata = match.get("metadata", {})
        map_name = str(metadata.get("map", "") or "")

        players_obj = match.get("players", {})
        all_players = []
        if isinstance(players_obj, dict):
            all_players = players_obj.get("all_players", [])
        elif isinstance(players_obj, list):
            all_players = players_obj

        for player in all_players:
            if not isinstance(player, dict):
                continue
            if str(player.get("puuid", "")).lower() != puuid:
                continue

            agent_name = self._player_agent_name(player)
            stats = player.get("stats", {}) if isinstance(player.get("stats"), dict) else {}
            score = int(stats.get("score", 0) or 0)
            kills = int(stats.get("kills", 0) or 0)
            deaths = int(stats.get("deaths", 0) or 0)
            assists = int(stats.get("assists", 0) or 0)

            player_team = str(player.get("team", "") or "").lower()
            result = self._determine_match_result(match, player_team)

            if agent_name:
                agent_games[agent_name] = agent_games.get(agent_name, 0) + 1
                if result == "win":
                    agent_wins[agent_name] = agent_wins.get(agent_name, 0) + 1

            if score > 0:
                score_sum += score
                score_count += 1

            if len(recent) < 10:
                recent.append({
                    "agent": agent_name,
                    "map": map_name,
                    "result": result,
                    "score": score,
                    "kills": kills,
                    "deaths": deaths,
                    "assists": assists,
                })
            return score_sum, score_count
        return None

    @staticmethod
    def _compute_top_agent(agent_games):
        """Return the agent name with the most games played."""
        top_agent = ""
        top_count = 0
        for agent_name, count in agent_games.items():
            if count > top_count:
                top_count = count
                top_agent = agent_name
        return top_agent

    @staticmethod
    def _build_agent_stats_list(agent_games, agent_wins):
        """Build a sorted list of agent stat dicts."""
        agent_stats = []
        for agent_name in sorted(agent_games, key=lambda a: agent_games[a], reverse=True):
            games = agent_games[agent_name]
            wins = agent_wins.get(agent_name, 0)
            agent_stats.append({
                "agent": agent_name,
                "games": games,
                "winrate": round(wins / max(1, games) * 100),
            })
        return agent_stats

    def _resolve_player_card(self, data):
        """Set the player card background in *data*."""
        card_url = get_equipped_card_url()
        if card_url:
            data[self.KEY_PLAYER_CARD_BG] = card_url
        elif not data.get(self.KEY_PLAYER_CARD_BG):
            random_card = self._get_random_playercard_url()
            if random_card:
                data[self.KEY_PLAYER_CARD_BG] = random_card

    @staticmethod
    def _player_agent_name(player):
        """Reads agent display name from the match player object."""
        # v3 API: "character" is a plain string like "Raze"
        agent = player.get("character")
        if isinstance(agent, str) and agent:
            return agent
        # v4 API fallback: "agent" is a dict with "name"
        if isinstance(agent, dict):
            return str(agent.get("name", "") or "")
        agent_obj = player.get("agent")
        if isinstance(agent_obj, dict):
            return str(agent_obj.get("name", "") or "")
        if isinstance(agent_obj, str) and agent_obj:
            return agent_obj
        return ""

    @staticmethod
    def _determine_match_result(match, player_team):
        """Return 'win', 'loss', or 'draw' based on team scoreboard."""
        if not player_team:
            return "draw"
        teams_score = match.get("teams", {})
        if not isinstance(teams_score, dict):
            return "draw"
        red = teams_score.get("red", {})
        blue = teams_score.get("blue", {})
        if not (isinstance(red, dict) and isinstance(blue, dict)):
            return "draw"
        red_wins = int(red.get("rounds_won", 0) or 0)
        blue_wins = int(blue.get("rounds_won", 0) or 0)
        if player_team == "red":
            if red_wins > blue_wins:
                return "win"
            if blue_wins > red_wins:
                return "loss"
        elif player_team == "blue":
            if blue_wins > red_wins:
                return "win"
            if red_wins > blue_wins:
                return "loss"
        return "draw"

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

    def _get_random_playercard_url(self):
        """Fetch a random playercard largeArt URL from valorant-api.com.

        Caches the card list on first call so subsequent random picks are free.
        """
        global _RANDOM_CARDS
        with _RANDOM_CARDS_LOCK:
            if _RANDOM_CARDS:
                card = random.choice(_RANDOM_CARDS)  # SonarCloud: safe — used for UI shuffle only
                return card.get("largeArt", "")

        # Fetch the list from the API
        import urllib.request
        try:
            req = urllib.request.Request(
                _PLAYERCARDS_API,
                headers={"User-Agent": "RiotSwitcher/2.0"},
            )
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
            cards = []
            for card in data.get("data", []):
                large_art = card.get("largeArt", "")
                if large_art:
                    cards.append({"uuid": card.get("uuid", ""), "largeArt": large_art})
            with _RANDOM_CARDS_LOCK:
                _RANDOM_CARDS = cards
            if cards:
                return random.choice(cards).get("largeArt", "")  # SonarCloud: safe — used for UI shuffle only
        except Exception:  # noqa: BLE001
            pass
        return ""
