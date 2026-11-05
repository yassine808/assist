"""Coverage for the live "which profile is running" watcher.

``RunningProfileWatcher`` is what keeps the lobby honest: a launched profile
must show as RUNNING, a sign-out or a killed client must clear that state, and
a short gap between launch and the session file being written must not make the
card flicker back to idle. These tests drive the shipped class directly.
"""

import sys
import unittest
from pathlib import Path
from unittest import mock

_SRC = Path(__file__).resolve().parent.parent / "src"
_BACKEND = _SRC / "backend"
for path in (str(_SRC), str(_BACKEND)):
    if path not in sys.path:
        sys.path.insert(0, path)

sys.modules.setdefault("riot_account_detect", mock.MagicMock())

from running_profile import RunningProfileWatcher  # noqa: E402


class _Profiles:
    def __init__(self, rows):
        self.rows = rows

    def load(self):
        return list(self.rows)


class _Config:
    def __init__(self):
        self.values = {}

    def get(self, key, default=""):
        return self.values.get(key, default)

    def set(self, key, value):
        self.values[key] = value


def _watcher(rows, live=None, running=True, on_change=None, grace=3):
    return RunningProfileWatcher(
        _Profiles(rows),
        _Config(),
        process_running=lambda: running,
        live_account=lambda: live or {},
        on_change=on_change,
        miss_grace=grace,
    )


class RunningProfileWatcherTests(unittest.TestCase):
    def test_reports_the_profile_matching_the_live_account(self):
        watcher = _watcher(
            [
                {"profile_name": "Main", "valorant_puuid": "puuid-main"},
                {"profile_name": "Alt", "valorant_puuid": "puuid-alt"},
            ],
            live={"puuid": "puuid-alt"},
        )

        self.assertEqual("Alt", watcher.refresh())
        self.assertEqual("Alt", watcher.current())
        self.assertEqual("Alt", watcher._config.get("LastRunningProfile"))

    def test_no_client_process_means_nothing_is_running(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
            running=False,
        )

        self.assertEqual("", watcher.refresh())

    def test_unknown_account_is_not_attributed_to_a_profile(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "someone-else"},
        )

        self.assertEqual("", watcher.refresh())

    def test_launch_gap_keeps_the_previous_state_until_the_grace_expires(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
            grace=3,
        )
        self.assertEqual("Main", watcher.refresh())

        # The client is restarting: the session file is briefly unreadable.
        watcher._live_account = lambda: {}
        self.assertEqual("Main", watcher.refresh())
        self.assertEqual("Main", watcher.refresh())
        self.assertEqual("", watcher.refresh())
        self.assertEqual("", watcher.current())

    def test_signing_out_publishes_a_cleared_state(self):
        changes = []
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
            on_change=changes.append,
            grace=1,
        )
        watcher.refresh()

        watcher._live_account = lambda: {}
        watcher.refresh()

        self.assertEqual(["Main", ""], changes)

    def test_publish_is_only_called_on_a_real_transition(self):
        changes = []
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
            on_change=changes.append,
        )

        watcher.refresh()
        watcher.refresh()
        watcher.refresh()

        self.assertEqual(["Main"], changes)

    def test_a_broken_listener_never_breaks_the_watcher(self):
        def explode(_name):
            raise RuntimeError("listener down")

        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
            on_change=explode,
        )

        self.assertEqual("Main", watcher.refresh())

    def test_a_session_read_error_is_treated_as_no_account(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
        )
        watcher._live_account = mock.Mock(side_effect=OSError("gone"))

        self.assertEqual("", watcher.refresh())

    def test_a_profile_read_error_is_treated_as_no_match(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
        )
        watcher._profiles.load = mock.Mock(side_effect=OSError("gone"))

        self.assertEqual("", watcher.refresh())

    def test_a_non_dict_profile_row_is_skipped(self):
        watcher = _watcher(
            ["not-a-profile", {"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
        )

        self.assertEqual("Main", watcher.refresh())

    def test_start_and_stop_are_idempotent(self):
        watcher = _watcher(
            [{"profile_name": "Main", "valorant_puuid": "puuid-main"}],
            live={"puuid": "puuid-main"},
        )
        watcher.start()
        first = watcher._thread
        watcher.start()
        self.assertIs(first, watcher._thread)

        watcher.stop()
        watcher.stop()
        self.assertTrue(watcher._stop.is_set())


if __name__ == "__main__":
    unittest.main()
