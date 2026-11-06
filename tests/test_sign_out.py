"""Sign-out: exit the Riot Client, drop the live login, keep the saved profile.

The feature exists so a user can leave an account without deleting it. The
per-profile backup is what makes switching back work, so every test here also
asserts that the backup survived.
"""

import os
import sys
from unittest import mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src", "backend"))

import launch_orchestrator  # noqa: E402
from launch_orchestrator import LaunchOrchestrator  # noqa: E402
from running_profile import RunningProfileWatcher  # noqa: E402
from session_manager import SessionManager  # noqa: E402

LIVE_LOGIN = ("Riot Games", "Riot Client", "Data")


def _make_live_client(local):
    """Create the live login files a signed-in Riot Client would have."""
    data = local.joinpath(*LIVE_LOGIN)
    (data / "Sessions").mkdir(parents=True)
    (data / "Sessions" / "Sessions").write_bytes(b"RSENC1\nlive-token")
    (data / "RiotGamesPrivateSettings.yaml").write_text("ssid: live-token")
    settings = data.parent / "Config" / "RiotClientSettings.yaml"
    settings.parent.mkdir(parents=True)
    settings.write_text("stay-signed-in: true")
    return data, settings


def _make_backup(root, name="Alpha"):
    backup = root / "profiles" / name
    backup.mkdir(parents=True)
    (backup / "Sessions").write_bytes(b"RSENC1\nsaved-token")
    (backup / "RiotGamesPrivateSettings.yaml").write_bytes(b"RSENC1\nsaved")
    return backup


def test_clear_live_session_removes_the_login_only(monkeypatch, tmp_path):
    local = tmp_path / "local"
    data, settings = _make_live_client(local)
    monkeypatch.setenv("LOCALAPPDATA", str(local))

    backup = _make_backup(tmp_path)
    sessions = SessionManager(str(tmp_path / "profiles"))

    assert sessions.clear_live_session(str(tmp_path / "install")) is True

    assert not (data / "Sessions").exists()
    assert not (data / "RiotGamesPrivateSettings.yaml").exists()
    # Client preferences are not a session and must survive.
    assert settings.exists()
    # The saved profile is the whole point: it stays.
    assert (backup / "Sessions").read_bytes().startswith(b"RSENC1")
    assert (backup / "RiotGamesPrivateSettings.yaml").exists()


def test_clear_live_session_is_fine_when_already_signed_out(monkeypatch, tmp_path):
    local = tmp_path / "local"
    local.mkdir()
    monkeypatch.setenv("LOCALAPPDATA", str(local))

    sessions = SessionManager(str(tmp_path / "profiles"))
    assert sessions.clear_live_session(str(tmp_path / "install")) is True


def test_clear_live_session_never_touches_the_install_dir(monkeypatch, tmp_path):
    local = tmp_path / "local"
    _make_live_client(local)
    monkeypatch.setenv("LOCALAPPDATA", str(local))

    install = tmp_path / "Riot Client"
    (install / "Config").mkdir(parents=True)
    client_config = install / "Config" / "client.config.yaml"
    client_config.write_text("keep: me")

    sessions = SessionManager(str(tmp_path / "profiles"))
    assert sessions.clear_live_session(str(install)) is True
    assert client_config.exists()


def _orchestrator(tmp_path, config=None):
    config = config or mock.MagicMock()
    config.get.return_value = "Alpha"
    profiles = mock.MagicMock()
    profiles.get.return_value = {}
    sessions = SessionManager(str(tmp_path / "profiles"))
    orchestrator = LaunchOrchestrator(
        mock.MagicMock(), sessions, profiles, config
    )
    orchestrator._install_dir = mock.MagicMock(return_value=str(tmp_path / "install"))
    return orchestrator, config


def test_sign_out_clears_the_login_and_keeps_the_profile(monkeypatch, tmp_path):
    local = tmp_path / "local"
    data, settings = _make_live_client(local)
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    backup = _make_backup(tmp_path)

    orchestrator, config = _orchestrator(tmp_path)
    monkeypatch.setattr(launch_orchestrator.rp, "is_running", lambda name: False)
    monkeypatch.setattr(launch_orchestrator.rp, "shutdown_stop", lambda: True)

    assert orchestrator.sign_out("Alpha") == {"ok": True}

    assert not (data / "Sessions").exists()
    assert not (data / "RiotGamesPrivateSettings.yaml").exists()
    assert settings.exists()
    assert (backup / "Sessions").exists()
    config.set.assert_any_call("LastRunningProfile", "")


def test_sign_out_refreshes_the_backup_before_signing_out(monkeypatch, tmp_path):
    """Switching back must still log in, so the live tokens are saved first."""
    local = tmp_path / "local"
    data, _settings = _make_live_client(local)
    monkeypatch.setenv("LOCALAPPDATA", str(local))
    backup = _make_backup(tmp_path)

    orchestrator, _config = _orchestrator(tmp_path)
    monkeypatch.setattr(launch_orchestrator.rp, "is_running", lambda name: False)
    monkeypatch.setattr(launch_orchestrator.rp, "shutdown_stop", lambda: True)

    orchestrator.sign_out("Alpha")

    saved = (backup / "Sessions").read_bytes()
    assert saved.startswith(b"RSENC1")
    assert b"live-token" not in saved or b"RSENC1" in saved
    assert not (data / "Sessions").exists()


def test_sign_out_refuses_while_valorant_runs(monkeypatch, tmp_path):
    """The UI gets the same prompt it uses for a blocked switch."""
    orchestrator, _config = _orchestrator(tmp_path)
    with mock.patch.object(launch_orchestrator.rp, "is_running", return_value=True), \
            mock.patch.object(launch_orchestrator.rp, "kill_all") as kill_all:
        result = orchestrator.sign_out("Alpha")

    assert result["ok"] is False
    assert result["code"] == launch_orchestrator.VALORANT_RUNNING
    kill_all.assert_not_called()


def test_watcher_clear_drops_the_running_profile_immediately():
    changes = []
    account = {"puuid": "p1"}
    profiles = mock.MagicMock()
    profiles.load.return_value = [{"profile_name": "Alpha", "valorant_puuid": "p1"}]
    watcher = RunningProfileWatcher(
        profiles,
        mock.MagicMock(),
        process_running=lambda: True,
        live_account=lambda: account,
        on_change=changes.append,
    )

    assert watcher.refresh() == "Alpha"
    account = {}  # the sign-out deleted the session file
    assert watcher.refresh() == "Alpha"  # still inside the miss grace
    watcher.clear()

    assert watcher.current() == ""
    assert changes[-1] == ""


@pytest.mark.parametrize("name", ["", "Alpha"])
def test_sign_out_survives_an_unknown_install_location(monkeypatch, tmp_path, name):
    local = tmp_path / "local"
    _make_live_client(local)
    monkeypatch.setenv("LOCALAPPDATA", str(local))

    orchestrator, _config = _orchestrator(tmp_path)
    orchestrator._install_dir = mock.MagicMock(
        side_effect=launch_orchestrator.RiotClientError("not found")
    )
    monkeypatch.setattr(launch_orchestrator.rp, "is_running", lambda proc: False)
    monkeypatch.setattr(launch_orchestrator.rp, "shutdown_stop", lambda: True)

    assert orchestrator.sign_out(name) == {"ok": True}
