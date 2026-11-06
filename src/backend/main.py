"""RiotSwitcher Python backend entry point."""

import os
import shutil
import subprocess
import sys
import threading
from types import SimpleNamespace

import animated_cards
import riot_account_detect as rad
from account_detector import AccountDetector, unique_profile_name
from agent_database import AgentDatabase
from config_manager import ConfigManager
from launch_orchestrator import LaunchOrchestrator
from league_settings_sync import LeagueSettingsSync
from playercard_store import PlayercardStore
from profile_manager import ProfileManager
from protocol import Protocol, ensure_utf8_streams
from riot_client import RiotClientManager
from running_profile import RunningProfileWatcher
from session_manager import SessionManager, sanitize_directory_name
from valorant_tracker import ValorantTracker

# Cached valorant-api.com map metadata (static list, fetched at most once).
_MAPS_CACHE = None


def _make_tracker(protocol, profiles, agent_db, playercards, config=None):
    tracker = ValorantTracker(
        profiles,
        on_update=lambda name, data: protocol.send_event(
            "valorant_data_updated", {"profile_name": name}
        ),
        agent_db=agent_db,
        playercard_store=playercards,
        config=config,
    )
    tracker.start()
    return tracker


def _seed_random_animated_card(profiles, protocol, profile_name):
    """Give a brand-new profile a random animated playercard.

    Runs at creation time rather than waiting for the first rank refresh: the
    tracker only resolves a card once it has stats to write, and a profile
    without an API key would otherwise stay blank. An existing card is never
    replaced, so re-running this is harmless. Returns True when a card was
    written.
    """
    if not profile_name:
        return False
    profile = profiles.get(profile_name)
    if not profile:
        return False
    valorant_data = profile.get("valorant_data")
    if not isinstance(valorant_data, dict):
        valorant_data = {}
    if valorant_data.get("player_card_bg"):
        return False
    card_url = animated_cards.random_card_url()
    if not card_url:
        return False

    valorant_data = dict(valorant_data)
    valorant_data["player_card_bg"] = card_url
    # Same provenance value the tracker writes for its random fallback.
    valorant_data["player_card_source"] = "random"
    profiles.update(profile_name, {"valorant_data": valorant_data})
    protocol.send_event("valorant_data_updated", {"profile_name": profile_name})
    return True


DATA_DIR_NAME = "RiotSwitcher"

# Items the backend itself owns. Anything else in the old Electron userData
# folder (Chromium cache, logs, updater state) is left alone.
APP_DATA_ITEMS = (
    "profiles",
    "profiles_data.json",
    "configs.json",
    "playercards.db",
    "agents.enc",
    "shared",
    "local.key",
)


def _program_data_dir():
    """Machine-wide data folder, independent of where the exe was launched."""
    base = (
        os.environ.get("PROGRAMDATA")
        or os.environ.get("ALLUSERSPROFILE")
        or r"C:\ProgramData"
    )
    return os.path.join(base, DATA_DIR_NAME)


def _legacy_data_dir():
    """Where older builds kept the backend data (Electron userData)."""
    return os.path.join(os.environ.get("APPDATA", "."), DATA_DIR_NAME)


def _determine_data_dir():
    """Determine the data directory for persistence."""
    override = os.environ.get("RIOTSWITCHER_DATA_DIR", "")
    if override:
        return override
    if "--dev" in sys.argv or os.environ.get("RIOTSWITCHER_DEV"):
        return os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), "data")
    return _program_data_dir()


def _restrict_data_dir(path):
    """Limit the data folder to this Windows user, SYSTEM and Administrators.

    The session files inside are already DPAPI-sealed, but the profile list
    still names the accounts. Denying other local users read access keeps the
    folder private as well. Best effort: a failure must never block start-up.
    """
    if not sys.platform.startswith("win"):
        return
    account = os.environ.get("USERNAME", "")
    domain = os.environ.get("USERDOMAIN", "")
    if not account:
        return
    if domain:
        account = f"{domain}\\{account}"
    try:
        subprocess.run(
            [
                "icacls", path,
                "/inheritance:r",
                "/grant:r", f"{account}:(OI)(CI)F",
                "/grant:r", "*S-1-5-18:(OI)(CI)F",
                "/grant:r", "*S-1-5-32-544:(OI)(CI)F",
            ],
            capture_output=True,
            timeout=15,
            creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
        )
    except (OSError, subprocess.SubprocessError):
        pass


def _move_item(source, destination):
    """Move a file or folder, falling back to copy-then-delete across volumes."""
    try:
        shutil.move(source, destination)
        return True
    except OSError:
        pass
    try:
        if os.path.isdir(source):
            shutil.copytree(source, destination)
        else:
            shutil.copy2(source, destination)
        if os.path.isdir(source):
            shutil.rmtree(source)
        else:
            os.remove(source)
        return True
    except OSError:
        return False


def _migrate_legacy_data(target):
    """Move backend data from %APPDATA%\\RiotSwitcher into the new location.

    Done once, by moving rather than copying: the user asked for no second copy
    of the saved session tokens on disk. Existing target items are never
    overwritten, so an already-migrated install is untouched.
    """
    if os.path.normcase(os.path.abspath(target)) != os.path.normcase(
        os.path.abspath(_program_data_dir())
    ):
        return 0
    legacy = _legacy_data_dir()
    if not os.path.isdir(legacy):
        return 0
    moved = 0
    for name in APP_DATA_ITEMS:
        source = os.path.join(legacy, name)
        destination = os.path.join(target, name)
        if not os.path.exists(source) or os.path.exists(destination):
            continue
        if _move_item(source, destination):
            moved += 1
    return moved


def _fetch_valorant_maps():
    """Return competitive map metadata from valorant-api.com.

    The map list is effectively static, so a successful fetch is cached in
    memory for the lifetime of the backend instead of refetched per render.
    A failed fetch is deliberately NOT cached, otherwise a single offline
    start-up would blank every map for the whole process lifetime.
    """
    global _MAPS_CACHE
    if _MAPS_CACHE:
        return _MAPS_CACHE

    import json as _json
    import urllib.request as _urllib_req
    try:
        req = _urllib_req.Request(
            "https://valorant-api.com/v1/maps",
            headers={"User-Agent": "RiotSwitcher/2.0"},
        )
        with _urllib_req.urlopen(req, timeout=10) as resp:
            data = _json.loads(resp.read().decode("utf-8"))
        maps = []
        for entry in data.get("data", []):
            display_name = str(entry.get("displayName", "") or "")
            if not display_name:
                continue
            maps.append({
                "name": display_name,
                "splash": entry.get("splash", ""),
                "display_icon": entry.get("displayIcon", ""),
                "thumbnail": entry.get("thumbnail", ""),
            })
        if maps:
            _MAPS_CACHE = maps
    except Exception:  # noqa: BLE001
        pass
    return _MAPS_CACHE or []


def _capture_session(name, sessions, profiles, config, install_dir_provider):
    """Back up the live Riot session into a newly created profile.

    A profile is only usable for switching once its session files are on disk:
    restoring a profile with no backup cannot log the client in, and the next
    switch would attribute the live session to the wrong profile. Returns True
    only when at least one session file was actually captured.
    """
    if not name:
        return False
    profile = profiles.get(name) or {}
    directory_name = profile.get("directory_name", "") or sanitize_directory_name(name)
    try:
        install_dir = install_dir_provider()
    except Exception:  # noqa: BLE001
        # The install dir only supplies the two client Config yaml files; the
        # account session itself lives under LOCALAPPDATA and is still worth
        # capturing when the client install has not been located yet.
        install_dir = ""
    try:
        if not sessions.save_session(directory_name, install_dir):
            return False
    except Exception:  # noqa: BLE001
        return False
    backup_dir = sessions.profile_dir(directory_name)
    try:
        captured = os.path.isdir(backup_dir) and bool(os.listdir(backup_dir))
    except OSError:
        captured = False
    if captured:
        # The account that just got added is the one running right now.
        config.set("LastRunningProfile", name)
    return captured



def _profiles_with_running(profiles, running):
    """Profiles with the live ``is_running`` flag filled in.

    ``is_running`` is runtime state, not part of the saved profile, so it is
    derived from the Riot Client watcher every time the list is read.
    """
    active = running.current()
    result = []
    for profile in profiles.load():
        item = dict(profile)
        item["is_running"] = bool(active) and item.get("profile_name") == active
        result.append(item)
    return result


def _launch_profile(orchestrator, running, name):
    result = orchestrator.switch_to(name)
    if result.get("ok"):
        # The client has just spawned; the watcher confirms the live account as
        # soon as the session file is written and emits the update that
        # re-renders the card.
        running.refresh()
    return result


def _create_profile_with_capture(profiles, protocol, capture_session, params):
    """Create a profile and immediately back up the live Riot session.

    Adding an account means "save the account that is logged in right now":
    without the session files on disk the profile cannot be switched back to
    later.
    """
    profile = profiles.create(params)
    _seed_random_animated_card(profiles, protocol, profile.get("profile_name", ""))
    capture_session(profile.get("profile_name", ""))
    return profile


def _delete_profile_and_dir(profiles, sessions, name):
    result = profiles.delete(name)
    try:
        sessions.delete_profile_dir(name or "")
    except Exception:  # noqa: BLE001
        pass
    return result


def _refresh_valorant(tracker, params):
    name = params.get("name")
    if name:
        return tracker.refresh_profile(name)
    return tracker.refresh_all()


def _profile_directory_name(profiles, name):
    profile = profiles.get(name) or {}
    directory_name = profile.get("directory_name", "")
    if not directory_name:
        directory_name = sanitize_directory_name(name or "profile")
    return directory_name


def _swap_profile_session(sessions, profiles, riot, profile_name, save):
    directory_name = _profile_directory_name(profiles, profile_name)
    install_dir = riot.ensure_location()
    if save:
        return sessions.save_session(directory_name, install_dir)
    return sessions.restore_session(directory_name, install_dir)


def _capture_profile_session(name, sessions, profiles, config, riot):
    return _capture_session(name, sessions, profiles, config, riot.ensure_location)


def _on_profile_created(profiles, protocol, tracker, sessions, config, riot, name):
    _seed_random_animated_card(profiles, protocol, name)
    _capture_profile_session(name, sessions, profiles, config, riot)
    tracker.refresh_profile(name)


def _league_config_dir(league):
    league_dir = league.find_league_dir()
    if not league_dir:
        return ""
    return os.path.join(league_dir, "Config")


def _cleanup_league_readonly(league):
    config_dir = _league_config_dir(league)
    if config_dir:
        league.cleanup_readonly_flags(config_dir)
    return True


def _set_playercard(profiles, protocol, profile_name, card_url):
    prof = profiles.get(profile_name)
    if not prof:
        raise ValueError(f"Profile '{profile_name}' not found")
    vd = prof.get("valorant_data", {}) or {}
    vd["player_card_bg"] = card_url
    # Record that this card was picked by hand. The tracker already preserves
    # any stored card, so this is provenance for diagnostics rather than
    # something the refresh path branches on.
    vd["player_card_source"] = "user"
    profiles.update(profile_name, {"valorant_data": vd})
    protocol.send_event("valorant_data_updated", {"profile_name": profile_name})
    return {"ok": True}


def _check_current_account(profiles):
    account = rad.read_live_account()
    if not account:
        return {"found": False, "display": "", "is_new": False}
    display = rad.display_uid(account)
    is_new = rad.is_account_new(account, profiles.load())
    return {"found": True, "display": display, "is_new": is_new, "account": account}


def _capture_current_account(profiles, protocol, tracker, sessions, config, riot):
    """Add the account that is logged into the Riot Client right now.

    ``added=True`` means a profile was created *and* its session files were
    copied. Every other outcome tells the UI to open a fresh client and wait
    for the user to log in, at which point the detector saves it.
    """
    account = rad.read_live_account()
    if not account:
        return {"added": False, "reason": "no_session", "display": ""}
    display = rad.display_uid(account)
    if not rad.is_account_new(account, profiles.load()):
        return {"added": False, "reason": "already_saved", "display": display}

    name, _counter = unique_profile_name(profiles, display)
    try:
        profile = profiles.create({
            "profile_name": name,
            "valorant_puuid": account.get("puuid", ""),
            "valorant_region": account.get("riot_region", ""),
            "valorant_in_game_name": display,
        })
    except Exception as exc:  # noqa: BLE001
        return {
            "added": False,
            "reason": "create_failed",
            "display": display,
            "message": str(exc),
        }

    if not _capture_profile_session(name, sessions, profiles, config, riot):
        # A profile without session files cannot be switched back to, so drop
        # it and let the caller fall through to a fresh login.
        try:
            profiles.delete(name)
        except Exception:  # noqa: BLE001
            pass
        try:
            sessions.delete_profile_dir(_profile_directory_name(profiles, name))
        except Exception:  # noqa: BLE001
            pass
        return {"added": False, "reason": "capture_failed", "display": display}

    _seed_random_animated_card(profiles, protocol, name)
    tracker.refresh_profile(name)
    return {"added": True, "reason": "created", "display": display, "profile": profile}


def _build_handlers(ctx):
    """Build the dispatch table mapping method names to handler functions."""
    profiles = ctx.profiles
    config = ctx.config
    riot = ctx.riot
    tracker = ctx.tracker
    detector = ctx.detector
    orchestrator = ctx.orchestrator
    sessions = ctx.sessions
    league = ctx.league
    protocol = ctx.protocol
    playercards = ctx.playercards
    running = ctx.running
    helpers = ctx.helpers

    return {
        "ping": lambda p: "pong",
        "get_profiles": lambda p: _profiles_with_running(profiles, running),
        "create_profile": lambda p: _create_profile_with_capture(
            profiles, protocol, helpers.capture_session, p
        ),
        "delete_profile": lambda p: _delete_profile_and_dir(
            profiles, sessions, p.get("name")
        ),
        "update_profile": lambda p: profiles.update(p.get("name"), p.get("data")),
        "rename_profile": lambda p: profiles.rename(p.get("old_name"), p.get("new_name")),
        "reorder_profiles": lambda p: profiles.reorder(p.get("names")),
        "get_valorant": lambda p: (profiles.get(p.get("name")) or {}).get(
            "valorant_data", {}
        ),
        "refresh_valorant": lambda p: _refresh_valorant(tracker, p),
        "refresh_valorant_all": lambda p: tracker.refresh_all(),
        "has_api_key": lambda p: tracker.has_key(),
        "get_config": lambda p: config.all(),
        "set_config": lambda p: config.set(p.get("key"), p.get("value")),
        "set_config_many": lambda p: config.set_many(p.get("items") or {}),
        "set_riot_client_location": lambda p: riot.set_location(p.get("folder")),
        "detect_riot_client_location": lambda p: riot.detect_install_dir(),
        "get_riot_client_status": lambda p: {
            **riot.status(),
            "profile": running.current(),
        },
        "stop_riot_client": lambda p: (riot.stop_and_wait(), None)[1],
        "launch_riot_client": lambda p: riot.launch_client(),
        "launch_profile": lambda p: _launch_profile(
            orchestrator, running, p.get("name") or ""
        ),
        "stop_profile": lambda p: orchestrator.stop(),
        "read_live_account": lambda p: rad.read_live_account(),
        "check_current_account": lambda p: helpers.check_current_account(),
        "capture_current_account": lambda p: helpers.capture_current_account(),
        "detect_live_account_new": lambda p: rad.is_account_new(
            p.get("account") or {}, profiles.load()
        ),
        "start_account_detection": lambda p: detector.start_detection(
            auto_save=bool(p.get("auto_save", True))
        ),
        "stop_account_detection": lambda p: (detector.stop_detection(), None)[1],
        "account_detection_state": lambda p: detector.is_running(),
        "confirm_account_save": lambda p: detector.confirm_save(
            bool(p.get("accept", True))
        ),
        "save_session": lambda p: helpers.swap_profile(p.get("name"), True),
        "restore_session": lambda p: helpers.swap_profile(p.get("name"), False),
        "has_session": lambda p: os.path.isdir(
            sessions.profile_dir(helpers.profile_dir_name(p.get("name")))
        ),
        "league_find_dir": lambda p: league.find_league_dir(),
        "league_capture": lambda p: league.capture_master_snapshot(
            p.get("source_dir"), p.get("directory_name", ""),
            p.get("display_name", p.get("directory_name", "")),
        ),
        "league_apply": lambda p: league.apply_master_snapshot_to_league(
            p.get("config_dir") or helpers.league_config_dir(),
            bool(p.get("enforce_readonly", True)),
        ),
        "league_refresh": lambda p: league.refresh_master_for_source(
            p.get("live_config_dir", "") or helpers.league_config_dir(),
            p.get("source_profile_dir", ""),
            p.get("directory_name", ""),
            p.get("display_name", p.get("directory_name", "")),
        ),
        "league_dir_differs": lambda p: league.settings_dir_differs_from_master(
            p.get("config_dir") or helpers.league_config_dir()
        ),
        "league_cleanup_readonly": lambda p: (
            helpers.cleanup_league_readonly(),
            None,
        )[1],
        "league_resolve_source": lambda p: league.resolve_source_profile(),
        "league_get_metadata": lambda p: league.get_snapshot_metadata(),
        "get_playercards": lambda p: playercards.get_cards(),
        "get_valorant_maps": lambda p: _fetch_valorant_maps(),
        "set_playercard": lambda p: helpers.set_playercard(
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
    # Must happen before any protocol I/O, and only in the real entry point:
    # wrapping the global streams at import time corrupts any process that
    # merely imports protocol (see protocol.ensure_utf8_streams).
    ensure_utf8_streams()
    data_dir = _determine_data_dir()
    os.makedirs(data_dir, exist_ok=True)
    _restrict_data_dir(data_dir)
    try:
        _migrate_legacy_data(data_dir)
    except Exception:  # noqa: BLE001 - migration must never block start-up
        pass

    protocol = Protocol()
    profiles = ProfileManager(os.path.join(data_dir, "profiles_data.json"))
    agent_db = AgentDatabase(data_dir)
    config = ConfigManager(os.path.join(data_dir, "configs.json"))
    playercards = PlayercardStore(data_dir)
    tracker = _make_tracker(protocol, profiles, agent_db, playercards, config)
    riot = RiotClientManager(config)
    riot.set_listener(lambda status: protocol.send_event(
        "riot_client_status", {"status": status}
    ))
    sessions = SessionManager(os.path.join(data_dir, "profiles"))
    try:
        # Upgrade path: seal session backups written before encryption existed.
        # A failure here must not block start-up — the plaintext backup still
        # restores, and the next save of that profile seals it.
        sessions.seal_existing_backups()
    except Exception:  # noqa: BLE001
        pass
    league = LeagueSettingsSync(
        config,
        profiles,
        os.path.join(data_dir, "shared", "settings"),
        install_dir_provider=lambda: riot.ensure_location(),
    )
    orchestrator = LaunchOrchestrator(
        riot, sessions, profiles, config,
        league=league,
    )
    orchestrator.set_listener(
        lambda step, status, message, extra: protocol.send_event(
            "profile_switch_progress",
            {"step": step, "status": status, "message": message, **extra},
        )
    )

    running = RunningProfileWatcher(
        profiles,
        config,
        process_running=riot.is_running,
        live_account=rad.read_live_account,
        on_change=lambda name: protocol.send_event(
            "riot_client_status",
            {"status": "running" if name else "stopped", "profile": name},
        ),
    )

    def _handle_event(name, data):
        protocol.send_event(name, data)

    detector = AccountDetector(
        profiles,
        on_event=_handle_event,
        launcher=riot.launch_client,
        on_profile_created=lambda name: _on_profile_created(
            profiles, protocol, tracker, sessions, config, riot, name
        ),
        killer=riot.kill_all_and_wait,
    )

    helpers = SimpleNamespace(
        league_config_dir=lambda: _league_config_dir(league),
        swap_profile=lambda name, save: _swap_profile_session(
            sessions, profiles, riot, name, save
        ),
        set_playercard=lambda name, url: _set_playercard(
            profiles, protocol, name, url
        ),
        check_current_account=lambda: _check_current_account(profiles),
        capture_current_account=lambda: _capture_current_account(
            profiles, protocol, tracker, sessions, config, riot
        ),
        profile_dir_name=lambda name: _profile_directory_name(profiles, name),
        cleanup_league_readonly=lambda: _cleanup_league_readonly(league),
        capture_session=lambda name: _capture_profile_session(
            name, sessions, profiles, config, riot
        ),
    )

    handlers = _build_handlers(SimpleNamespace(
        profiles=profiles,
        config=config,
        riot=riot,
        tracker=tracker,
        detector=detector,
        orchestrator=orchestrator,
        sessions=sessions,
        league=league,
        protocol=protocol,
        playercards=playercards,
        running=running,
        helpers=helpers,
    ))

    running.start()

    protocol.send_event("backend_ready", {"data_dir": data_dir})
    sys.stderr.write(f"[backend] ready, data_dir={data_dir}\n")
    sys.stderr.flush()

    # Warm the player-card catalogue off the protocol thread: first run
    # downloads it once, later runs only re-check when it is a week old.
    threading.Thread(target=playercards.get_cards, daemon=True).start()

    try:
        _message_loop(protocol, handlers)
    finally:
        # stdin closed: tear the refresh timer and worker down explicitly rather
        # than relying on daemon-thread death at interpreter exit.
        running.stop()
        tracker.stop()


if __name__ == "__main__":
    main()
