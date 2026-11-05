"""App shutdown must never terminate VALORANT or the Riot Client.

Closing RiotSwitcher is not a request to close anything: VALORANT and the Riot
Client may be running before the switcher opens, and closing the switcher is
unrelated to them. A profile switch keeps its normal behaviour (the Riot Client
is restarted, and the switch is refused while VALORANT runs); the shutdown path
stops neither process.
"""

import os
import sys
import unittest
from unittest import mock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

import launch_orchestrator  # noqa: E402
import riot_client  # noqa: E402
import riot_processes as rp  # noqa: E402
from launch_orchestrator import LaunchOrchestrator  # noqa: E402


class TestShutdownLeavesValorantRunning(unittest.TestCase):
    def test_shutdown_stop_only_targets_the_riot_client(self):
        with mock.patch.object(rp, "kill_all") as kill_all, \
                mock.patch.object(rp, "wait_until_dead", return_value=True):
            rp.shutdown_stop()

        kill_all.assert_called_once_with(rp.RIOT_CLIENT_PROCESSES)
        targeted = kill_all.call_args[0][0]
        self.assertNotIn("VALORANT.exe", targeted)
        self.assertNotIn("ValorantWin64Shipping.exe", targeted)

    def test_orchestrator_stop_uses_the_shutdown_path(self):
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "shutdown_stop") as stop, \
                mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
            self.assertEqual(orchestrator.stop(), {"ok": True})

        stop.assert_called_once_with()
        kill_all.assert_not_called()

    def test_riot_client_stop_job_does_not_kill_the_game(self):
        client = riot_client.RiotClientManager(mock.MagicMock())
        client._jobs.append("stop")
        with mock.patch.object(riot_client.rp, "shutdown_stop", return_value=True) as stop, \
                mock.patch.object(riot_client.rp, "kill_all") as kill_all:
            client._worker()

        stop.assert_called_once_with()
        kill_all.assert_not_called()

    def test_profile_switch_stops_the_client_not_the_game(self):
        """A switch restarts the Riot Client; VALORANT is left alone."""
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "is_running", return_value=False), \
                mock.patch.object(launch_orchestrator.rp, "shutdown_stop", return_value=True) as stop, \
                mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
            ok, error = orchestrator._kill_riot_processes()

        self.assertTrue(ok)
        self.assertEqual(error, "")
        stop.assert_called_once_with()
        kill_all.assert_not_called()

    def test_no_helper_can_target_valorant(self):
        """The VALORANT-only kill helpers are gone, not just unused."""
        self.assertFalse(hasattr(rp, "kill_valorant"))
        self.assertFalse(hasattr(rp, "close_valorant_then_client"))

    def test_backend_has_no_close_all_or_kill_all_method(self):
        """No backend IPC method can terminate every Riot process."""
        import main

        self.assertFalse(hasattr(main, "_close_all"))
        self.assertNotIn("close_valorant_then_client", dir(main))

    def test_switch_refuses_while_valorant_is_running(self):
        """With the game open the switch aborts instead of closing anything."""
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "is_running", return_value=True), \
                mock.patch.object(launch_orchestrator.rp, "shutdown_stop") as stop, \
                mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
            ok, error = orchestrator._kill_riot_processes()

        self.assertFalse(ok)
        self.assertIn("VALORANT", error)
        stop.assert_not_called()
        kill_all.assert_not_called()


if __name__ == "__main__":
    unittest.main()
