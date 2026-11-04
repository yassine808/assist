"""Tests for the local player-card catalogue.

The contract under test is "the network is touched once, then never again
unless the cache is a week old": a returning user must get cards with the
internet disconnected, and a failed refresh must keep whatever is stored.
"""

import json
import os
import sys
import tempfile
import time
import unittest
from unittest import mock

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
for _p in (os.path.join(_ROOT, "src"), os.path.join(_ROOT, "src", "backend")):
    if _p not in sys.path:
        sys.path.insert(0, _p)

from backend import playercard_store as ps  # noqa: E402

API_CARD_A = {
    "uuid": "aaa",
    "displayName": "Alpha",
    "largeArt": "https://media.valorant-api.com/playercards/aaa/largeart.png",
}
API_CARD_B = {
    "uuid": "bbb",
    "displayName": "Bravo",
    "largeArt": "https://media.valorant-api.com/playercards/bbb/largeart.png",
}


class FakeResponse:
    def __init__(self, payload):
        self._body = json.dumps(payload).encode("utf-8")

    def read(self):
        return self._body

    def __enter__(self):
        return self

    def __exit__(self, *exc_info):
        return False


def api_payload(*cards):
    return {"status": 200, "data": list(cards)}


class StoreTestCase(unittest.TestCase):
    def setUp(self):
        self._tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self._tmp.cleanup)
        self.store = ps.PlayercardStore(self._tmp.name)

    def patch_api(self, *payloads):
        """Patch urlopen for the module, yielding one payload per call."""
        responses = [FakeResponse(p) for p in payloads]
        return mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=responses
        )


class TestFirstRun(StoreTestCase):
    def test_first_call_downloads_and_persists(self):
        with self.patch_api(api_payload(API_CARD_A, API_CARD_B)) as urlopen:
            cards = self.store.get_cards()

        self.assertEqual(urlopen.call_count, 1)
        self.assertEqual([c["displayName"] for c in cards], ["Alpha", "Bravo"])
        self.assertEqual(cards[0]["uuid"], "aaa")
        self.assertEqual(cards[0]["largeArt"], API_CARD_A["largeArt"])
        self.assertTrue(os.path.exists(os.path.join(self._tmp.name, "playercards.db")))

    def test_second_call_never_touches_the_network(self):
        with self.patch_api(api_payload(API_CARD_A)):
            self.store.get_cards()

        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=AssertionError("network used")
        ):
            cards = self.store.get_cards()

        self.assertEqual(len(cards), 1)
        self.assertEqual(cards[0]["uuid"], "aaa")

    def test_new_store_instance_reuses_the_same_file(self):
        with self.patch_api(api_payload(API_CARD_A, API_CARD_B)):
            self.store.get_cards()

        reopened = ps.PlayercardStore(self._tmp.name)
        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=AssertionError("network used")
        ):
            cards = reopened.get_cards()

        self.assertEqual(len(cards), 2)

    def test_offline_first_run_returns_empty_instead_of_raising(self):
        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=OSError("offline")
        ):
            self.assertEqual(self.store.get_cards(), [])
            self.assertEqual(self.store.random_card_url(), "")

    def test_offline_first_run_does_not_retry_immediately(self):
        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=OSError("offline")
        ) as urlopen:
            self.store.get_cards()
            self.store.get_cards()
            self.store.random_card_url()

        # One download attempt, then the backoff window suppresses the rest.
        self.assertEqual(urlopen.call_count, 1)


class TestRefresh(StoreTestCase):
    def _seed(self):
        with self.patch_api(api_payload(API_CARD_A)):
            self.store.get_cards()

    def test_weekly_staleness_schedules_a_background_refresh(self):
        self._seed()
        stale = time.time() - ps.REFRESH_INTERVAL_S - 1
        with mock.patch.object(self.store, "last_sync", return_value=stale), \
                mock.patch.object(self.store, "refresh_async") as refresh_async:
            self.store.get_cards()
        refresh_async.assert_called_once_with()

    def test_fresh_cache_does_not_schedule_a_refresh(self):
        self._seed()
        with mock.patch.object(self.store, "refresh_async") as refresh_async:
            self.store.get_cards()
        refresh_async.assert_not_called()

    def test_refresh_merges_new_cards_and_updates_existing(self):
        self._seed()
        renamed = dict(API_CARD_A, displayName="Alpha Renamed")
        with self.patch_api(api_payload(renamed, API_CARD_B)):
            self.assertTrue(self.store.refresh())

        cards = {c["uuid"]: c for c in self.store.get_cards()}
        self.assertEqual(set(cards), {"aaa", "bbb"})
        self.assertEqual(cards["aaa"]["displayName"], "Alpha Renamed")
        self.assertEqual(cards["bbb"]["largeArt"], API_CARD_B["largeArt"])

    def test_cards_missing_from_a_later_response_are_kept(self):
        self._seed()
        with self.patch_api(api_payload(API_CARD_B)):
            self.store.refresh()
        self.assertEqual({c["uuid"] for c in self.store.get_cards()}, {"aaa", "bbb"})

    def test_failed_refresh_keeps_the_stored_catalogue(self):
        self._seed()
        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=OSError("offline")
        ):
            self.assertFalse(self.store.refresh())

        cards = self.store.get_cards()
        self.assertEqual([c["uuid"] for c in cards], ["aaa"])

    def test_failed_refresh_does_not_advance_last_sync(self):
        self._seed()
        before = self.store.last_sync()
        with mock.patch.object(
            ps.urllib.request, "urlopen", side_effect=OSError("offline")
        ):
            self.store.refresh()
        self.assertEqual(self.store.last_sync(), before)

    def test_successful_refresh_advances_last_sync(self):
        self._seed()
        before = self.store.last_sync()
        time.sleep(0.01)
        with self.patch_api(api_payload(API_CARD_A, API_CARD_B)):
            self.store.refresh()
        self.assertGreater(self.store.last_sync(), before)


class TestRandomCard(StoreTestCase):
    def test_random_card_comes_from_the_cache(self):
        with self.patch_api(api_payload(API_CARD_A, API_CARD_B)) as urlopen:
            self.store.get_cards()
            for _ in range(5):
                self.assertIn(
                    self.store.random_card_url(),
                    {API_CARD_A["largeArt"], API_CARD_B["largeArt"]},
                )

        self.assertEqual(urlopen.call_count, 1)


if __name__ == "__main__":
    unittest.main()
