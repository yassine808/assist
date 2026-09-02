"""RiotSwitcher Python backend entry point."""

import sys

from protocol import Protocol
from profile_manager import ProfileManager
from valorant_tracker import ValorantTracker
from config_manager import ConfigManager
from riot_client import RiotClientManager, RiotClientError
from session_manager import SessionManager, sanitize_directory_name
import riot_account_detect as rad


def _make_tracker(protocol, profiles):
    tracker = ValorantTracker(profiles, on_update=lambda name, data: protocol.send_event(
        "valorant_data_updated", {"profile_name": name}
    ))
    tracker.start()
    return tracker


def main():
    import os

    # Determine workspace directory for data persistence.
    if "--dev" in sys.argv or os.environ.get("RIOTSWITCHER_DEV"):
        data_dir = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    else:
        # Packaged: use user-writable app data dir.
        base = os.environ.get("APPDATA", ".")
        data_dir = os.path.join(base, "RiotSwitcher")

    os.makedirs(data_dir, exist_ok=True)

    protocol = Protocol()
    profiles = ProfileManager(os.path.join(data_dir, "profiles_data.json"))
    tracker = _make_tracker(protocol, profiles)
    config = ConfigManager(os.path.join(data_dir, "configs.json"))
    riot = RiotClientManager(config)
    riot.set_listener(lambda status: protocol.send_event(
        "riot_client_status", {"status": status}
    ))
    sessions = SessionManager(os.path.join(data_dir, "profiles"))


    def _profile_dir_name(name):
        """Resolve a stable backup-directory name for a profile."""
        profile = profiles.get(name) or {}
        directory_name = profile.get("directory_name", "")
        if not directory_name:
            directory_name = sanitize_directory_name(name or "profile")
        return directory_name


    def _install_dir():
        """Return the live Riot Client install dir, auto-detecting if unset."""
        return riot.ensure_location()


    def _swap_profile(profile_name, save):
        directory_name = _profile_dir_name(profile_name)
        install_dir = _install_dir()
        if save:
            return sessions.save_session(directory_name, install_dir)
        return sessions.restore_session(directory_name, install_dir)

    handlers = {
        "ping": lambda p: "pong",
        "get_profiles": lambda p: profiles.load(),
        "create_profile": lambda p: profiles.create(p),
        "delete_profile": lambda p: profiles.delete(p.get("name")),
        "update_profile": lambda p: profiles.update(p.get("name"), p.get("data")),
        "rename_profile": lambda p: profiles.rename(p.get("old_name"), p.get("new_name")),
        "reorder_profiles": lambda p: profiles.reorder(p.get("names")),
        "get_valorant": lambda p: (profiles.get(p.get("name")) or {}).get("valorant_data", {}),
        "refresh_valorant": lambda p: tracker.refresh_profile(p.get("name")) if p.get("name") else tracker.refresh_all(),
        "refresh_valorant_all": lambda p: tracker.refresh_all(),
        "has_api_key": lambda p: tracker.has_key(),
        # Config
        "get_config": lambda p: config.all(),
        "set_config": lambda p: config.set(p.get("key"), p.get("value")),
        "set_config_many": lambda p: config.set_many(p.get("items") or {}),
        # Riot Client lifecycle
        "set_riot_client_location": lambda p: riot.set_location(p.get("folder")),
        "detect_riot_client_location": lambda p: riot.detect_install_dir(),
        "get_riot_client_status": lambda p: riot.status(),
        "kill_riot_processes": lambda p: (riot.kill_all(), None)[1],
        "stop_riot_client": lambda p: (riot.stop_and_wait(), None)[1],
        "launch_riot_client": lambda p: riot.launch_client(),
        # Live account detection
        "read_live_account": lambda p: rad.read_live_account(),
        "detect_live_account_new": lambda p: rad.is_account_new(
            p.get("account") or {}, profiles.load()
        ),
        # Session file swap
        "save_session": lambda p: _swap_profile(p.get("name"), True),
        "restore_session": lambda p: _swap_profile(p.get("name"), False),
        "has_session": lambda p: os.path.isdir(sessions.profile_dir(_profile_dir_name(p.get("name")))),
    }

    # Announce ready so the parent knows initialization succeeded.
    protocol.send_event("backend_ready", {"data_dir": data_dir})
    sys.stderr.write(f"[backend] ready, data_dir={data_dir}\n")
    sys.stderr.flush()

    while True:
        request = protocol.read_request()
        if request is None:
            break

        request_id = request.get("id")
        method = request.get("method")
        params = request.get("params", {}) or {}

        handler = handlers.get(method)
        if handler is None:
            protocol.send_response(request_id, error=f"Unknown method: {method}")
            continue

        try:
            result = handler(params)
            protocol.send_response(request_id, result=result)
        except Exception as exc:  # noqa: BLE001
            protocol.send_response(request_id, error=repr(exc))


if __name__ == "__main__":
    main()
