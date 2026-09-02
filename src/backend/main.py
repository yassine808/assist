"""RiotSwitcher Python backend entry point."""

import sys

from protocol import Protocol
from profile_manager import ProfileManager
from valorant_tracker import ValorantTracker


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
