"""RiotSwitcher Python backend entry point."""

import os
import sys

import riot_account_detect as rad
from account_detector import AccountDetector
from agent_database import AgentDatabase
from config_manager import ConfigManager
from deceive.presence_manager import PresenceManager
from launch_orchestrator import LaunchOrchestrator
from league_settings_sync import LeagueSettingsSync
from profile_manager import ProfileManager
from protocol import Protocol
from riot_client import RiotClientManager
from riot_processes import close_valorant_then_client
from session_manager import SessionManager, sanitize_directory_name
from valorant_tracker import ValorantTracker


def _pid_is_running(pid):
    try:
        import psutil
        return psutil.pid_exists(pid)
    except Exception:  # noqa: BLE001
        return False


def _make_tracker(protocol, profiles, agent_db):
    tracker = ValorantTracker(
        profiles,
        on_update=lambda name, data: protocol.send_event(
            "valorant_data_updated", {"profile_name": name}
        ),
        agent_db=agent_db,
    )
    tracker.start()
    return tracker


def _determine_data_dir():
    """Determine the data directory for persistence."""
    if "--dev" in sys.argv or os.environ.get("RIOTSWITCHER_DEV"):
        return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    base = os.environ.get("APPDATA", ".")
    return os.path.join(base, "RiotSwitcher")


def _fetch_playercards():
    """Fetch all playercards from valorant-api.com."""
    import json as _json
    import urllib.request as _urllib_req
    try:
        req = _urllib_req.Request(
            "https://valorant-api.com/v1/playercards",
            headers={"User-Agent": "RiotSwitcher/2.0"},
        )
        with _urllib_req.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        cards = []
        for card in data.get("data", []):
            large_art = card.get("largeArt", "")
            if large_art:
                cards.append({
                    "uuid": card.get("uuid", ""),
                    "displayName": card.get("displayName", ""),
                    "largeArt": large_art,
                })
        return cards
    except Exception:  # noqa: BLE001
        return []


def _build_handlers(profiles, config, riot, tracker, detector, orchestrator,
                     sessions, league, presence, protocol, data_dir,
                     _league_config_dir, _swap_profile, _set_playercard,
                     _check_current_account, _close_all,
                     _profile_dir_name, _cleanup_league_readonly):
    """Build the dispatch table mapping method names to handler functions."""
    return {
        "ping": lambda p: "pong",
        "get_profiles": lambda p: profiles.load(),
        "create_profile": lambda p: profiles.create(p),
        "delete_profile": lambda p: (
            profiles.delete(p.get("name")),
            sessions.delete_profile_dir(p.get("name") or ""),
        )[-1],
        "update_profile": lambda p: profiles.update(p.get("name"), p.get("data")),
        "rename_profile": lambda p: profiles.rename(p.get("old_name"), p.get("new_name")),
        "reorder_profiles": lambda p: profiles.reorder(p.get("names")),
        "get_valorant": lambda p: (profiles.get(p.get("name")) or {}).get("valorant_data", {}),
        "refresh_valorant": lambda p: tracker.refresh_profile(p.get("name")) if p.get("name") else tracker.refresh_all(),
        "refresh_valorant_all": lambda p: tracker.refresh_all(),
        "has_api_key": lambda p: tracker.has_key(),
        "get_config": lambda p: config.all(),
        "set_config": lambda p: config.set(p.get("key"), p.get("value")),
        "set_config_many": lambda p: config.set_many(p.get("items") or {}),
        "set_riot_client_location": lambda p: riot.set_location(p.get("folder")),
        "detect_riot_client_location": lambda p: riot.detect_install_dir(),
        "get_riot_client_status": lambda p: riot.status(),
        "kill_riot_processes": lambda p: (riot.kill_all(), None)[1],
        "stop_riot_client": lambda p: (riot.stop_and_wait(), None)[1],
        "close_all": lambda p: _close_all(),
        "launch_riot_client": lambda p: riot.launch_client(),
        "launch_profile": lambda p: orchestrator.switch_to(p.get("name") or ""),
        "stop_profile": lambda p: orchestrator.stop(),
        "read_live_account": lambda p: rad.read_live_account(),
        "check_current_account": lambda p: _check_current_account(),
        "detect_live_account_new": lambda p: rad.is_account_new(
            p.get("account") or {}, profiles.load()
        ),
        "start_account_detection": lambda p: detector.start_detection(),
        "stop_account_detection": lambda p: (detector.stop_detection(), None)[1],
        "account_detection_state": lambda p: detector.is_running(),
        "confirm_account_save": lambda p: detector.confirm_save(bool(p.get("accept", True))),
        "save_session": lambda p: _swap_profile(p.get("name"), True),
        "restore_session": lambda p: _swap_profile(p.get("name"), False),
        "has_session": lambda p: os.path.isdir(sessions.profile_dir(_profile_dir_name(p.get("name")))),
        "league_find_dir": lambda p: league.find_league_dir(),
        "league_capture": lambda p: league.capture_master_snapshot(
            p.get("source_dir"), p.get("directory_name", ""),
            p.get("display_name", p.get("directory_name", "")),
        ),
        "league_apply": lambda p: league.apply_master_snapshot_to_league(
            p.get("config_dir") or _league_config_dir(),
            bool(p.get("enforce_readonly", True)),
        ),
        "league_refresh": lambda p: league.refresh_master_for_source(
            p.get("live_config_dir", "") or _league_config_dir(),
            p.get("source_profile_dir", ""),
            p.get("directory_name", ""),
            p.get("display_name", p.get("directory_name", "")),
        ),
        "league_dir_differs": lambda p: league.settings_dir_differs_from_master(
            p.get("config_dir") or _league_config_dir()
        ),
        "league_cleanup_readonly": lambda p: (_cleanup_league_readonly(), None)[1],
        "league_resolve_source": lambda p: league.resolve_source_profile(),
        "league_get_metadata": lambda p: league.get_snapshot_metadata(),
        "presence_start": lambda p: (presence.start_proxy(), None)[1],
        "presence_stop": lambda p: (presence.stop_proxy(), None)[1],
        "presence_state": lambda p: presence.get_state(),
        "presence_get_ports": lambda p: {
            "config": presence.get_config_port(),
            "chat": presence.get_chat_port(),
            "running": presence.get_state() in ("READY", "RUNNING"),
        },
        "presence_get_launch_args": lambda p: presence.get_launch_args(
            riot.build_launch_args()
        ),
        "export_profiles": lambda p: {
            "data": list(profiles.export_profiles(p.get("passkey", "")))
        },
        "import_profiles": lambda p: profiles.import_profiles(
            p.get("passkey", ""),
            bytes(p.get("data", [])),
            merge=bool(p.get("merge", True)),
        ),
        "get_playercards": lambda p: _fetch_playercards(),
        "set_playercard": lambda p: _set_playercard(
            p.get("name", ""), p.get("card_url", "")
        ),
    }


def _message_loop(protocol, handlers):
    """Process incoming IPC requests until the connection closes."""
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


def main():
    data_dir = _determine_data_dir()
    os.makedirs(data_dir, exist_ok=True)

    protocol = Protocol()
    profiles = ProfileManager(os.path.join(data_dir, "profiles_data.json"))
    agent_db = AgentDatabase(data_dir)
    tracker = _make_tracker(protocol, profiles, agent_db)
    config = ConfigManager(os.path.join(data_dir, "configs.json"))
    riot = RiotClientManager(config)
    riot.set_listener(lambda status: protocol.send_event(
        "riot_client_status", {"status": status}
    ))
    sessions = SessionManager(os.path.join(data_dir, "profiles"))
    league = LeagueSettingsSync(
        config,
        profiles,
        os.path.join(data_dir, "shared", "settings"),
        install_dir_provider=lambda: riot.ensure_location(),
    )
    presence = PresenceManager(config, is_process_running=_pid_is_running)
    riot.set_launch_args_provider(presence.get_launch_args)

    orchestrator = LaunchOrchestrator(
        riot, sessions, profiles, config,
        league=league, presence=presence,
    )
    orchestrator.set_listener(
        lambda step, status, message, extra: protocol.send_event(
            "profile_switch_progress",
            {"step": step, "status": status, "message": message, **extra},
        )
    )

    def _handle_event(name, data):
        protocol.send_event(name, data)

    detector = AccountDetector(
        profiles, on_event=_handle_event, launcher=riot.launch_client,
        on_profile_created=lambda name: tracker.refresh_profile(name),
        killer=riot.kill_all,
    )

    def _league_config_dir():
        league_dir = league.find_league_dir()
        if not league_dir:
            return ""
        return os.path.join(league_dir, "Config")

    def _cleanup_league_readonly():
        config_dir = _league_config_dir()
        if config_dir:
            league.cleanup_readonly_flags(config_dir)
        return True

    def _profile_dir_name(name):
        profile = profiles.get(name) or {}
        directory_name = profile.get("directory_name", "")
        if not directory_name:
            directory_name = sanitize_directory_name(name or "profile")
        return directory_name

    def _install_dir():
        return riot.ensure_location()

    def _swap_profile(profile_name, save):
        directory_name = _profile_dir_name(profile_name)
        install_dir = _install_dir()
        if save:
            return sessions.save_session(directory_name, install_dir)
        return sessions.restore_session(directory_name, install_dir)

    def _set_playercard(profile_name, card_url):
        prof = profiles.get(profile_name)
        if not prof:
            raise ValueError(f"Profile '{profile_name}' not found")
        vd = prof.get("valorant_data", {}) or {}
        vd["player_card_bg"] = card_url
        profiles.update(profile_name, {"valorant_data": vd})
        protocol.send_event("valorant_data_updated", {"profile_name": profile_name})
        return {"ok": True}

    def _check_current_account():
        account = rad.read_live_account()
        if not account:
            return {"found": False, "display": "", "is_new": False}
        display = rad.display_uid(account)
        profiles_list = profiles.load()
        is_new = rad.is_account_new(account, profiles_list)
        return {"found": True, "display": display, "is_new": is_new, "account": account}

    def _close_all():
        import threading
        def _do_close():
            ok = close_valorant_then_client()
            protocol.send_event("close_complete", {"ok": ok})
        threading.Thread(target=_do_close, daemon=True).start()
        return {"ok": True}

    handlers = _build_handlers(
        profiles, config, riot, tracker, detector, orchestrator,
        sessions, league, presence, protocol, data_dir,
        _league_config_dir, _swap_profile, _set_playercard,
        _check_current_account, _close_all,
        _profile_dir_name, _cleanup_league_readonly,
    )

    protocol.send_event("backend_ready", {"data_dir": data_dir})
    sys.stderr.write(f"[backend] ready, data_dir={data_dir}\n")
    sys.stderr.flush()

    _message_loop(protocol, handlers)


if __name__ == "__main__":
    main()
