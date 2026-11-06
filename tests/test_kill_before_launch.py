"""Regression: the kill step must finish before a profile launches the client.

Reported bug: clicking LAUNCH on a profile spawned no Riot Client at all. The
launcher log for the spawned pid stopped ~16 ms in, right after ``Lock file was
not detected`` - the process had been killed, not crashed.

Cause: ``kill_all`` only *starts* ``taskkill``; nothing waited for those
processes. ``wait_until_dead`` then returned at once whenever no Riot process
was running (the common case after a previous launch failed), the orchestrator
spawned the new client, and the still-unexecuted ``taskkill`` enumerated the
process table afterwards, matched the *new* ``RiotClientServices.exe`` and
killed it. A switch while a client was already open worked, because that wait
gave the taskkills time to run - which is why the bug looked intermittent.

``kill_and_wait`` now waits for every taskkill process before reporting done.
"""

import os
import subprocess
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

import riot_processes as rp  # noqa: E402

# tests/conftest.py disarms `kill_all` for every test; keep the real one here so
# the handle-collection behaviour can be exercised without touching taskkill.
_REAL_KILL_ALL = rp.kill_all


class TestKillAndWait(unittest.TestCase):
    def test_waits_for_every_taskkill_before_waiting_for_the_targets(self):
        events = []
        procs = [mock.MagicMock(), mock.MagicMock()]
        for index, proc in enumerate(procs):
            proc.wait.side_effect = lambda timeout=None, i=index: events.append(f"taskkill{i}")

        def record_dead(*_args, **_kwargs):
            events.append("targets")
            return True

        with mock.patch.object(rp, "kill_all", return_value=procs) as kill_all, \
                mock.patch.object(rp, "wait_until_dead", side_effect=record_dead):
            self.assertTrue(rp.kill_and_wait(["RiotClientServices.exe"]))

        self.assertEqual(events, ["taskkill0", "taskkill1", "targets"])
        kill_all.assert_called_once_with(["RiotClientServices.exe"])

    def test_reports_a_taskkill_that_never_finishes(self):
        proc = mock.MagicMock()
        proc.wait.side_effect = subprocess.TimeoutExpired("taskkill", 8)

        with mock.patch.object(rp, "kill_all", return_value=[proc]), \
                mock.patch.object(rp, "wait_until_dead") as wait:
            self.assertFalse(rp.kill_and_wait(["RiotClientServices.exe"]))

        wait.assert_not_called()

    @unittest.skipUnless(
        sys.platform == "win32",
        "kill_all spawns taskkill with CREATE_NO_WINDOW, so it only runs on Windows",
    )
    def test_kill_all_returns_the_taskkill_handles(self):
        """The caller needs the handles to wait on; discarding them was the bug."""
        fake = mock.MagicMock()
        with mock.patch.object(rp.subprocess, "Popen", return_value=fake) as popen:
            procs = _REAL_KILL_ALL(["RiotClientServices.exe"])

        self.assertEqual(procs, [fake])
        self.assertEqual(popen.call_count, 1)

    def test_shutdown_stop_uses_kill_and_wait(self):
        with mock.patch.object(rp, "kill_and_wait", return_value=True) as kill_and_wait:
            self.assertTrue(rp.shutdown_stop())

        kill_and_wait.assert_called_once_with(rp.RIOT_CLIENT_PROCESSES)

    def test_terminate_valorant_uses_kill_and_wait(self):
        with mock.patch.object(rp, "kill_and_wait", return_value=True) as kill_and_wait:
            self.assertTrue(rp.terminate_valorant())

        kill_and_wait.assert_called_once_with(rp.VALORANT_PROCESSES)


if __name__ == "__main__":
    unittest.main()
