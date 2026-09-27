"""Regression tests for fixes shipped in commit 89c0719.

Two bugs are covered here:

1. ``main._fetch_valorant_maps`` permanently memoized a *failed* fetch, so one
   offline start-up blanked every map for the whole process lifetime.
2. ``ValorantTracker._enqueue`` could strand a job when the previous worker
   thread died in the window between ``start()`` returning and the re-check,
   and ``ValorantTracker.stop()`` never cancelled the self-re-arming
   auto-refresh timer.

These exercise the shipped code paths directly; nothing is reimplemented.
"""

import json
import sys
import threading
import unittest
from pathlib import Path
from unittest.mock import MagicMock, patch

_SRC = Path(__file__).resolve().parent.parent / "src"
_BACKEND = _SRC / "backend"
for path in (str(_SRC), str(_BACKEND)):
    if path not in sys.path:
        sys.path.insert(0, path)

# Follow tests/conftest.py and tests/test_backend.py: install the stub with
# setdefault, NOT patch.dict. pytest imports every test module during collection,
# so a patch.dict here would restore a pre-import sys.modules snapshot mid-session
# and un-register modules that `main` pulled in (cryptography, urllib.request, ...).
# Those objects survive only as stale attributes on their parent packages, so a
# later re-import rebuilds them -- which trips CPython's "PyO3 modules ... may only
# be initialized once per interpreter process" guard in unrelated test files, and
# silently defeats patch("urllib.request.urlopen") here.
sys.modules.setdefault("riot_account_detect", MagicMock())

from valorant_tracker import ValorantTracker  # noqa: E402

import main  # noqa: E402

MAPS_URL_PAYLOAD = {
    "data": [
        {
            "displayName": "Ascent",
            "splash": "https://example/ascent-splash.png",
            "displayIcon": "https://example/ascent-icon.png",
            "thumbnail": "https://example/ascent-thumb.png",
        },
        {
            "displayName": "Haven",
            "splash": "https://example/haven-splash.png",
            "displayIcon": "https://example/haven-icon.png",
            "thumbnail": "https://example/haven-thumb.png",
        },
    ]
}


def _urlopen_returning(payload):
    """Build a urlopen() stand-in returning `payload` as JSON bytes."""
    body = json.dumps(payload).encode("utf-8")

    class _Response:
        def __enter__(self):
            return self

        def __exit__(self, *_exc):
            return False

        def read(self):
            return body

    return _Response()


class MapMetadataCacheTests(unittest.TestCase):
    """`_fetch_valorant_maps` must cache success but never cache failure."""

    def setUp(self):
        # _MAPS_CACHE is module-global mutable state; isolate every test.
        main._MAPS_CACHE = None
        self.addCleanup(setattr, main, "_MAPS_CACHE", None)

    def test_successful_fetch_is_cached_and_reused(self):
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = _urlopen_returning(MAPS_URL_PAYLOAD)
            first = main._fetch_valorant_maps()
            second = main._fetch_valorant_maps()

        self.assertEqual(2, len(first))
        self.assertEqual(["Ascent", "Haven"], [m["name"] for m in first])
        # Second call served from cache: exactly one network hit for two calls.
        self.assertEqual(1, urlopen.call_count)
        self.assertIs(first, second)

    def test_failed_fetch_is_not_cached_and_is_retried(self):
        """The core regression: a failure must not poison the cache forever."""
        with patch("urllib.request.urlopen", side_effect=OSError("offline")) as urlopen:
            result = main._fetch_valorant_maps()

            # Caller gets an empty list...
            self.assertEqual([], result)
            # ...but the empty list was NOT memoized.
            self.assertIsNone(main._MAPS_CACHE)

            # A later call must retry the network rather than return the
            # permanently-cached failure.
            urlopen.side_effect = None
            urlopen.return_value = _urlopen_returning(MAPS_URL_PAYLOAD)
            recovered = main._fetch_valorant_maps()

        self.assertEqual(2, urlopen.call_count)
        self.assertEqual(["Ascent", "Haven"], [m["name"] for m in recovered])
        self.assertIsNotNone(main._MAPS_CACHE)

    def test_empty_but_successful_payload_is_not_cached(self):
        """A 200 response with no usable maps must stay retryable too."""
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = _urlopen_returning({"data": []})
            self.assertEqual([], main._fetch_valorant_maps())
            self.assertIsNone(main._MAPS_CACHE)

            # Re-fetch: the previous empty result did not short-circuit.
            urlopen.return_value = _urlopen_returning(MAPS_URL_PAYLOAD)
            self.assertEqual(2, len(main._fetch_valorant_maps()))

        self.assertEqual(2, urlopen.call_count)

    def test_malformed_entries_are_skipped_but_good_ones_cached(self):
        payload = {
            "data": [
                {"displayName": "Bind"},
                {"displayName": ""},          # no name -> dropped
                {"splash": "https://x/y.png"},  # no name -> dropped
            ]
        }
        with patch("urllib.request.urlopen") as urlopen:
            urlopen.return_value = _urlopen_returning(payload)
            maps = main._fetch_valorant_maps()

        self.assertEqual(["Bind"], [m["name"] for m in maps])
        self.assertIsNotNone(main._MAPS_CACHE)


class TrackerShutdownTests(unittest.TestCase):
    """`stop()` must halt the re-arming timer and drain the queue."""

    def _make_tracker(self):
        profiles = MagicMock()
        profiles.load.return_value = []
        client = MagicMock()
        client.has_key = False
        return ValorantTracker(profiles, client=client)

    def test_stop_cancels_timer_and_drains_queue(self):
        tracker = self._make_tracker()
        timer = MagicMock()
        tracker._auto_refresh_timer = timer
        tracker._auto_refresh_active = True
        tracker._jobs.append({"kind": "mmr", "profile_name": "p"})

        tracker.stop()

        timer.cancel.assert_called_once()
        self.assertFalse(tracker._auto_refresh_active)
        self.assertIsNone(tracker._auto_refresh_timer)
        self.assertEqual([], tracker._jobs)

    def test_stop_is_idempotent_and_safe_without_timer(self):
        tracker = self._make_tracker()
        tracker.stop()
        tracker.stop()  # must not raise
        self.assertIsNone(tracker._auto_refresh_timer)

    def test_tick_after_stop_does_not_rearm_timer(self):
        """The bug: `_auto_refresh_tick`'s finally-block re-armed forever."""
        tracker = self._make_tracker()
        tracker._auto_refresh_active = True
        tracker.stop()

        # Simulate a timer callback that was already in flight when stop() ran.
        tracker._auto_refresh_tick()

        self.assertFalse(tracker._auto_refresh_active)
        self.assertIsNone(tracker._auto_refresh_timer)


class TrackerLostWakeupTests(unittest.TestCase):
    """`_enqueue` must never leave a job with no live worker thread."""

    def _make_tracker(self):
        profiles = MagicMock()
        profiles.load.return_value = []
        client = MagicMock()
        client.has_key = False
        tracker = ValorantTracker(profiles, client=client)
        # Never arm the real 2-minute timer during tests.
        tracker._auto_refresh_active = True
        self.addCleanup(tracker.stop)
        return tracker

    def test_enqueue_rescues_job_when_worker_died_during_start(self):
        tracker = self._make_tracker()

        # The old worker is winding down: `start()` sees it alive and no-ops,
        # then it exits before _enqueue's re-check. The job would be stranded.
        dying = threading.Thread(target=lambda: None, daemon=True)
        dying.start()
        dying.join()

        def _start_that_loses_the_race(_tracker_self):
            # Leaves a finished thread in place, exactly like the real
            # start() early-return path followed by worker exit.
            tracker._thread = dying

        # The replacement worker has to stay alive to be observable: a worker
        # that returns instantly would finish before the assertion below and
        # the test would prove nothing.
        release = threading.Event()
        self.addCleanup(release.set)
        started = threading.Event()

        def _blocking_worker(_self):
            started.set()
            release.wait(5.0)

        losing_start = patch.object(ValorantTracker, "start", _start_that_loses_the_race)
        blocking_worker = patch.object(ValorantTracker, "_worker", _blocking_worker)
        with losing_start, blocking_worker:
                tracker._enqueue("mmr", "prof", "puuid-1", "na")

                self.assertTrue(started.wait(2.0), "rescued worker never started")
                self.assertEqual(1, len(tracker._jobs), "job must still be queued")
                self.assertIsNotNone(tracker._thread, "rescue must install a thread")
                self.assertTrue(
                    tracker._thread.is_alive(),
                    "a live worker thread must exist after a stranded enqueue",
                )

    def test_enqueue_does_not_spawn_a_second_thread_when_worker_is_healthy(self):
        tracker = self._make_tracker()
        stop_holder = threading.Event()

        def _slow_worker(_self):
            while not stop_holder.is_set():
                threading.Event().wait(0.01)

        with patch.object(ValorantTracker, "_worker", _slow_worker):
            tracker._enqueue("mmr", "prof", "puuid-1", "na")
            first_thread = tracker._thread
            self.assertTrue(tracker._thread_is_running())

            tracker._enqueue("mmr", "prof", "puuid-2", "na")
            # Same thread object: no duplicate worker, no double-processing.
            self.assertIs(first_thread, tracker._thread)

        stop_holder.set()
        if tracker._thread is not None:
            tracker._thread.join(timeout=2)

    def test_pop_job_returns_none_on_empty_queue(self):
        tracker = self._make_tracker()
        self.assertIsNone(tracker._pop_job())
        tracker._jobs.append({"kind": "mmr"})
        self.assertEqual({"kind": "mmr"}, tracker._pop_job())
        self.assertIsNone(tracker._pop_job())


if __name__ == "__main__":
    unittest.main()
