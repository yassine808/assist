"""App shutdown must never terminate VALORANT or the Riot Client.

Closing RiotSwitcher is not a request to close anything: VALORANT and the Riot
Client may be running before the switcher opens, and closing the switcher is
unrelated to them. A profile switch keeps its normal behaviour (the Riot Client
is restarted, and the switch is refused while VALORANT runs); the shutdown path
stops neither process.

The one path that does close the game is `quit_valorant`, and only after the
user answers the "Quit VALORANT?" dialog. The tests below pin both halves: the
automatic paths never target the game, and the confirmed path targets nothing
but the game's own two processes (Vanguard is never in the list).
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
        with mock.patch.object(rp, "kill_all", return_value=[]) as kill_all, \
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
            ok, error, code = orchestrator._kill_riot_processes()

        self.assertTrue(ok)
        self.assertEqual(error, "")
        self.assertEqual(code, "")
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
        """With the game open the switch aborts and asks the UI to prompt."""
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "is_running", return_value=True), \
                mock.patch.object(launch_orchestrator.rp, "shutdown_stop") as stop, \
                mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
            ok, error, code = orchestrator._kill_riot_processes()

        self.assertFalse(ok)
        self.assertIn("VALORANT", error)
        self.assertEqual(code, launch_orchestrator.VALORANT_RUNNING)
        stop.assert_not_called()
        kill_all.assert_not_called()

    def test_switch_result_carries_the_valorant_running_code(self):
        """The dialog is triggered by `code`, not by matching the message text."""
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        orchestrator._install_dir = mock.MagicMock(return_value="C:/Riot Client")
        with mock.patch.object(launch_orchestrator.rp, "is_running", return_value=True), \
                mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
            result = orchestrator.switch_to("Beta#EUW")

        self.assertFalse(result["ok"])
        self.assertEqual(result["code"], launch_orchestrator.VALORANT_RUNNING)
        kill_all.assert_not_called()

    def test_quit_valorant_targets_only_the_game(self):
        """The confirmed dialog kills the game's processes, never Vanguard."""
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "kill_all", return_value=[]) as kill_all, \
                mock.patch.object(launch_orchestrator.rp, "wait_until_dead", return_value=True):
            self.assertEqual(orchestrator.quit_valorant(), {"ok": True})

        kill_all.assert_called_once_with(launch_orchestrator.rp.VALORANT_PROCESSES)
        targeted = kill_all.call_args[0][0]
        self.assertIn("VALORANT.exe", targeted)
        self.assertIn("ValorantWin64Shipping.exe", targeted)
        self.assertNotIn("vgc.exe", targeted)
        self.assertNotIn("RiotClientServices.exe", targeted)

    def test_quit_valorant_reports_a_game_that_will_not_close(self):
        orchestrator = LaunchOrchestrator(
            mock.MagicMock(), mock.MagicMock(), mock.MagicMock(), mock.MagicMock()
        )
        with mock.patch.object(launch_orchestrator.rp, "kill_all"), \
                mock.patch.object(launch_orchestrator.rp, "wait_until_dead", return_value=False):
            result = orchestrator.quit_valorant()

        self.assertFalse(result["ok"])
        self.assertIn("still running", result["error"])


if __name__ == "__main__":
    unittest.main()
