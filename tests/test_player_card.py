"""Tests for player-card resolution and map aggregate shape.

``_resolve_player_card`` guards one invariant: a stored card is never replaced.
Both historical defects violated it. Cross-account contamination came from the
Riot client lockfile, which describes whichever account is logged in right now,
so a timer refresh copied account B's card onto account A's profile; that
reader has since been removed. Silent clobbering came from the random fallback
replacing whatever was stored, which erased an explicit ``set_playercard``
choice. The tests below pin the surviving rule for both freshly written and
pre-provenance profiles.

The map-aggregate tests pin the ``map_stats`` contract the README documents.
"""

import os
import sys
import unittest
from unittest import mock

# Allow `python -m unittest tests.test_player_card` as well as pytest.
_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.join(_ROOT, "src"), os.path.join(_ROOT, "src", "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from backend import valorant_tracker as vt  # noqa: E402

CARD_A = "https://media.valorant-api.com/playercards/aaa/largeart.png"
CARD_B = "https://media.valorant-api.com/playercards/bbb/largeart.png"
RANDOM_CARD = "https://media.valorant-api.com/playercards/rnd/largeart.png"

KEY_CARD = "player_card_bg"
KEY_SOURCE = "player_card_source"


def make_tracker():
    """Build a ValorantTracker without touching disk or the network.

    ``__init__`` is bypassed because it wires up the profile manager and the
    agent database; the helpers under test only need ``_agent_meta`` to
    degrade gracefully, which it does when ``_agent_db`` is None.
    """
    with mock.patch.object(vt.ValorantTracker, "__init__", lambda self: None):
        tracker = vt.ValorantTracker()
    tracker._agent_db = None
    return tracker


class TestResolvePlayerCard(unittest.TestCase):
    """`_resolve_player_card` fills an empty card and never replaces a set one.

    There is no live/auto-detected card any more (the Riot client lockfile
    reader was removed), so the whole contract reduces to: a stored card is
    immutable, and an empty one gets a single random fallback.
    """

    def setUp(self):
        self.tracker = make_tracker()

    def _resolve(self, data, random_card=RANDOM_CARD):
        with mock.patch.object(
            vt.ValorantTracker, "_get_random_playercard_url", return_value=random_card
        ) as fallback:
            self.tracker._resolve_player_card(data)
        return fallback

    def test_random_fallback_fills_an_empty_profile(self):
        data = {}
        self._resolve(data)
        self.assertEqual(data[KEY_CARD], RANDOM_CARD)
        self.assertEqual(data[KEY_SOURCE], "random")

    def test_user_choice_is_never_overwritten(self):
        """An explicit pick outranks the fallback."""
        data = {KEY_CARD: CARD_B, KEY_SOURCE: "user"}
        fallback = self._resolve(data)
        self.assertEqual(data[KEY_CARD], CARD_B)
        self.assertEqual(data[KEY_SOURCE], "user")
        fallback.assert_not_called()

    def test_legacy_card_without_provenance_is_never_overwritten(self):
        """Pre-provenance profiles must not lose their card on first refresh."""
        data = {KEY_CARD: CARD_A}
        fallback = self._resolve(data)
        self.assertEqual(data[KEY_CARD], CARD_A)
        fallback.assert_not_called()

    def test_already_seeded_card_is_not_re_rolled(self):
        """A second pass must not re-roll an already-populated card."""
        data = {KEY_CARD: RANDOM_CARD, KEY_SOURCE: "random"}
        other = "https://media.valorant-api.com/playercards/other/largeart.png"
        fallback = self._resolve(data, random_card=other)
        self.assertEqual(data[KEY_CARD], RANDOM_CARD)
        self.assertEqual(data[KEY_SOURCE], "random")
        fallback.assert_not_called()

    def test_empty_catalog_leaves_card_unset(self):
        """A failed catalog fetch must not write a bogus card."""
        data = {}
        self._resolve(data, random_card=None)
        self.assertNotIn(KEY_CARD, data)
        self.assertNotIn(KEY_SOURCE, data)


class TestMapStatsShape(unittest.TestCase):
    def setUp(self):
        self.tracker = make_tracker()

    def test_sorted_by_games_desc(self):
        acc = vt._MatchAccumulator()
        acc.map_games = {"Ascent": 10, "Bind": 30, "Haven": 20}
        acc.map_wins = {"Ascent": 5, "Bind": 15, "Haven": 4}
        stats = self.tracker._build_map_stats(acc)
        self.assertEqual([m["map"] for m in stats], ["Bind", "Haven", "Ascent"])

    def test_winrate_rounded_to_int_percent(self):
        acc = vt._MatchAccumulator()
        acc.map_games = {"Ascent": 30}
        acc.map_wins = {"Ascent": 15}
        stats = self.tracker._build_map_stats(acc)
        self.assertEqual(stats[0]["winrate"], 50)

    def test_avg_score_zero_when_no_scores_recorded(self):
        acc = vt._MatchAccumulator()
        acc.map_games = {"Ascent": 3}
        acc.map_wins = {"Ascent": 1}
        stats = self.tracker._build_map_stats(acc)
        self.assertEqual(stats[0]["avg_score"], 0)

    def test_avg_score_from_recorded_scores(self):
        acc = vt._MatchAccumulator()
        acc.map_games = {"Ascent": 2}
        acc.map_wins = {"Ascent": 1}
        acc.map_score_sum = {"Ascent": 481}
        acc.map_score_count = {"Ascent": 2}
        stats = self.tracker._build_map_stats(acc)
        self.assertEqual(stats[0]["avg_score"], 240)  # 240.5 rounds to 240

    def test_recent_matches_capped_at_ten(self):
        acc = vt._MatchAccumulator()
        for i in range(25):
            acc.append_recent({"i": i})
        self.assertEqual(len(acc.recent), 10)
        self.assertEqual(acc.recent[0]["i"], 0)

    def test_agents_sorted_by_games_desc(self):
        acc = vt._MatchAccumulator()
        acc.map_games = {"Ascent": 30}
        acc.map_agents = {
            "Ascent": {
                "Jett": {"games": 5, "wins": 3, "score_sum": 1000, "score_count": 5},
                "Sova": {"games": 20, "wins": 8, "score_sum": 4000, "score_count": 20},
            }
        }
        stats = self.tracker._build_map_stats(acc)
        self.assertEqual([a["agent"] for a in stats[0]["agents"]], ["Sova", "Jett"])
        self.assertEqual(stats[0]["agents"][0]["avg_score"], 200)
        # Degrades gracefully with no agent database loaded.
        self.assertEqual(stats[0]["agents"][0]["display_icon"], "")
        self.assertEqual(stats[0]["agents"][0]["role"], "")


if __name__ == "__main__":
    unittest.main()
