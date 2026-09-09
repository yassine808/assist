"""League of Legends settings sync across profiles via a master snapshot.

Mirrors the Godot LeagueSettingsSync (src/utils/league_settings_sync.gd): one
validated, cryptographically-hashed master snapshot of the shared settings is
kept and deployed to whichever profile is currently starting, so hotkeys, video,
audio, interface and smartcast stay consistent across every account.

Single Authority Rule: the profile designated as the Source Profile is the SOLE
authority for shared settings. If the source profile is missing, corrupted, or
unvalidated, apply operations are aborted.
"""

import hashlib
import json
import os
import shutil
import subprocess
import threading
import time

# Result codes for apply / capture / refresh operations (strings are easier to
# return over the JSON protocol than ints).
APPLY_SUCCESS = "SUCCESS"
APPLY_SYNC_DISABLED = "SYNC_DISABLED"
APPLY_SOURCE_NOT_CONFIGURED = "SOURCE_NOT_CONFIGURED"
APPLY_SOURCE_MISSING = "SOURCE_MISSING"
APPLY_SNAPSHOT_MISSING = "SNAPSHOT_MISSING"
APPLY_SNAPSHOT_CORRUPT = "SNAPSHOT_CORRUPT"
APPLY_HASH_MISMATCH = "HASH_MISMATCH"
APPLY_DEPLOY_FAILED = "DEPLOY_FAILED"
APPLY_DEPLOY_VERIFICATION_FAILED = "DEPLOY_VERIFICATION_FAILED"

CAPTURE_SUCCESS = "SUCCESS"
CAPTURE_SOURCE_NOT_FOUND = "SOURCE_NOT_FOUND"
CAPTURE_INVALID_SOURCE_FILES = "INVALID_SOURCE_FILES"
CAPTURE_CORRUPT_PERSISTED_SETTINGS = "CORRUPT_PERSISTED_SETTINGS"
CAPTURE_STAGING_FAILED = "STAGING_FAILED"
CAPTURE_METADATA_WRITE_FAILED = "METADATA_WRITE_FAILED"

CONFIG_KEY_ENABLED = "SyncGameSettings"
CONFIG_KEY_SOURCE_DIR = "SharedSettingsSourceDirectory"
CONFIG_KEY_SOURCE_NAME_LEGACY = "SharedSettingsSourceProfile"
CONFIG_KEY_READONLY = "EnforceReadOnlySettings"

FILE_PERSISTED_SETTINGS = "PersistedSettings.json"
FILE_ITEM_SETS = "ItemSets.json"

SHARED_FILES = [
    "game.cfg",
    FILE_PERSISTED_SETTINGS,
    "input.ini",
    FILE_ITEM_SETS,
]

SHARED_DIRS = [
    "Champions",
]

METADATA_FILENAME = "metadata.json"
SCHEMA_VERSION = 2

RIOT_INSTALLS_JSON = r"C:/ProgramData/Riot Games/RiotClientInstalls.json"
RIOT_METADATA_YAML = r"C:/ProgramData/Riot Games/Metadata/league_of_legends.live/league_of_legends.live.product_settings.yaml"

REG_KEYS = [
    r"HKCU\Software\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
    r"HKLM\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
    r"HKLM\SOFTWARE\WOW6432Node\Microsoft\Windows\CurrentVersion\Uninstall\Riot Game league_of_legends.live",
]

_WIN = os.name == "nt"


def _sha256(path):
    """SHA-256 hex digest of a file, or '' if it cannot be read."""
    try:
        h = hashlib.sha256()
        with open(path, "rb") as fh:
            for chunk in iter(lambda: fh.read(1 << 20), b""):
                h.update(chunk)
        return h.hexdigest()
    except OSError:
        return ""


class LeagueSettingsSync:
    """Per-profile sharing of League game settings through a master snapshot."""

    def __init__(self, config, profiles, shared_dir, install_dir_provider=None):
        self._config = config
        self._profiles = profiles
        self._shared_dir = shared_dir
        # Callable returning the Riot Client install dir (used for sibling
        # detection and as a fallback install source).
        self._install_dir_provider = install_dir_provider
        self._mutex = threading.RLock()

    # ------------------------------------------------------------------ #
    # Paths
    # ------------------------------------------------------------------ #

    def master_dir(self):
        return self._shared_dir

    def metadata_path(self):
        return os.path.join(self.master_dir(), METADATA_FILENAME)

    # ------------------------------------------------------------------ #
    # Source resolution
    # ------------------------------------------------------------------ #

    def _is_safe_path(self, path, *allowed_bases):
        """Return True if *path* resolves inside one of *allowed_bases*."""
        try:
            resolved = os.path.realpath(path)
            for base in allowed_bases:
                if resolved.startswith(os.path.realpath(base)):
                    return True
        except (OSError, ValueError):
            pass
        return False

    def _resolve_profile_by_dir_name(self, directory_name, all_profiles):
        """Find a profile matching *directory_name* and return a result dict."""
        for profile in all_profiles:
            if str(profile.get("directory_name", "") or "") == directory_name:
                return {
                    "is_valid": True,
                    "directory_name": directory_name,
                    "display_name": profile.get("profile_name", directory_name),
                    "profile_dir": os.path.join(self._shared_dir, "..", "profiles", directory_name),
                }
        return None

    def resolve_source_profile(self):
        """Resolve the configured source profile.

        Returns a dict with is_valid, directory_name, display_name,
        profile_dir, error_message.
        """
        configured_dir = str(self._config.get(CONFIG_KEY_SOURCE_DIR, "") or "")
        legacy_name = str(self._config.get(CONFIG_KEY_SOURCE_NAME_LEGACY, "") or "")
        all_profiles = self._profiles.load() or []

        if configured_dir:
            match = self._resolve_profile_by_dir_name(configured_dir, all_profiles)
            if match:
                return match
            return {
                "is_valid": False,
                "directory_name": "",
                "display_name": "",
                "profile_dir": "",
                "error_message": f"Source profile directory '{configured_dir}' no longer exists.",
            }

        if legacy_name:
            result = self._resolve_profile_by_legacy_name(legacy_name, all_profiles)
            if result:
                return result
            return {
                "is_valid": False,
                "directory_name": "",
                "display_name": "",
                "profile_dir": "",
                "error_message": f"Legacy source profile '{legacy_name}' not found.",
            }

        return {
            "is_valid": False,
            "directory_name": "",
            "display_name": "",
            "profile_dir": "",
            "error_message": "No source profile configured.",
        }

    def _resolve_profile_by_legacy_name(self, legacy_name, all_profiles):
        """Look up *legacy_name* in profile_name and migrate to directory_name."""
        for profile in all_profiles:
            if str(profile.get("profile_name", "") or "") == legacy_name:
                dir_name = str(profile.get("directory_name", "") or "")
                if dir_name:
                    self._config.set(CONFIG_KEY_SOURCE_DIR, dir_name)
                    return {
                        "is_valid": True,
                        "directory_name": dir_name,
                        "display_name": legacy_name,
                        "profile_dir": os.path.join(self._shared_dir, "..", "profiles", dir_name),
                    }
        return None

    # ------------------------------------------------------------------ #
    # Validation & hashing
    # ------------------------------------------------------------------ #

    def validate_persisted_settings_file(self, file_path):
        if not os.path.isfile(file_path):
            return False
        try:
            with open(file_path, encoding="utf-8") as fh:
                content = fh.read()
        except OSError:
            return False
        if not content.strip() or len(content) < 16:
            return False
        try:
            parsed = json.loads(content)
        except ValueError:
            return False
        if not isinstance(parsed, dict):
            return False
        return isinstance(parsed.get("files"), (list, dict))

    def has_valid_settings(self, dir_path):
        if not dir_path or not os.path.isdir(dir_path):
            return False
        has_cfg = os.path.isfile(os.path.join(dir_path, "game.cfg"))
        has_json = self.validate_persisted_settings_file(
            os.path.join(dir_path, FILE_PERSISTED_SETTINGS)
        )
        has_input = os.path.isfile(os.path.join(dir_path, "input.ini"))
        return bool(has_cfg or has_json or has_input)

    def get_snapshot_metadata(self):
        if not os.path.isfile(self.metadata_path()):
            return {}
        try:
            with open(self.metadata_path(), encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return {}
        return data if isinstance(data, dict) else {}

    def settings_dir_differs_from_master(self, dir_path):
        """True when tracked files in dir_path differ from the master snapshot."""
        if not dir_path or not os.path.isdir(dir_path):
            return True
        if not self._is_safe_path(dir_path, self._shared_dir, os.path.dirname(self._shared_dir)):
            return True
        meta = self.get_snapshot_metadata()
        file_hashes = meta.get("file_hashes", {}) or {}
        if not file_hashes:
            return True
        for filename in file_hashes:
            if filename == FILE_ITEM_SETS:
                continue
            candidate = os.path.join(dir_path, filename)
            if not os.path.isfile(candidate):
                return True
            if _sha256(candidate) != str(file_hashes[filename]):
                return True
        return False

    # ------------------------------------------------------------------ #
    # Copy helpers
    # ------------------------------------------------------------------ #

    def _copy_dir_recursive(self, source_dir, dest_dir):
        try:
            shutil.copytree(source_dir, dest_dir, dirs_exist_ok=True)
        except OSError:
            pass

    def _remove_dir_recursive(self, path):
        if os.path.isdir(path):
            shutil.rmtree(path, ignore_errors=True)

    def _set_file_readonly_windows(self, path, readonly):
        if not _WIN or not os.path.isfile(path):
            return
        flag = "+R" if readonly else "-R"
        try:
            subprocess.run(
                ["attrib", flag, path.replace("/", "\\")],
                capture_output=True, timeout=10,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    def _set_dir_readonly_windows(self, path, readonly):
        if not _WIN or not os.path.isdir(path):
            return
        flag = "+R" if readonly else "-R"
        try:
            subprocess.run(
                ["attrib", flag, os.path.join(path, "*.*").replace("/", "\\"), "/S"],
                capture_output=True, timeout=30,
            )
        except (OSError, subprocess.TimeoutExpired):
            pass

    # ------------------------------------------------------------------ #
    # Capture
    # ------------------------------------------------------------------ #

    def capture_master_snapshot(self, source_dir, source_dir_name, source_display_name):
        with self._mutex:
            return self._capture_master_snapshot_unlocked(
                source_dir, source_dir_name, source_display_name
            )

    def _capture_master_snapshot_unlocked(self, source_dir, source_dir_name, source_display_name):
        if not source_dir or not os.path.isdir(source_dir):
            return CAPTURE_SOURCE_NOT_FOUND
        if not self._is_safe_path(source_dir, os.path.dirname(self._shared_dir)):
            return CAPTURE_SOURCE_NOT_FOUND
        if not self.has_valid_settings(source_dir):
            return CAPTURE_INVALID_SOURCE_FILES

        persisted_path = os.path.join(source_dir, FILE_PERSISTED_SETTINGS)
        if os.path.isfile(persisted_path) and not self.validate_persisted_settings_file(persisted_path):
            return CAPTURE_CORRUPT_PERSISTED_SETTINGS

        staging_dir = self.master_dir() + "_tmp"
        self._remove_dir_recursive(staging_dir)
        try:
            os.makedirs(staging_dir, exist_ok=True)
        except OSError:
            return CAPTURE_STAGING_FAILED

        file_hashes, file_sizes, files_present = self._copy_shared_files_to_staging(source_dir, staging_dir)
        if file_hashes is None:
            return CAPTURE_STAGING_FAILED
        self._copy_shared_dirs_to_staging(source_dir, staging_dir, files_present)

        prev_meta = self.get_snapshot_metadata()
        next_gen = int(prev_meta.get("generation", 0) or 0) + 1
        metadata = {
            "schema_version": SCHEMA_VERSION,
            "source_directory": source_dir_name,
            "source_display_name": source_display_name,
            "captured_at_unix": time.time(),
            "captured_at_iso": time.strftime("%Y-%m-%dT%H:%M:%S"),
            "generation": next_gen,
            "files_present": files_present,
            "file_hashes": file_hashes,
            "file_sizes": file_sizes,
        }
        try:
            with open(os.path.join(staging_dir, METADATA_FILENAME), "w", encoding="utf-8") as fh:
                json.dump(metadata, fh, indent="\t")
        except OSError:
            self._remove_dir_recursive(staging_dir)
            return CAPTURE_METADATA_WRITE_FAILED

        try:
            os.makedirs(self.master_dir(), exist_ok=True)
        except OSError:
            self._remove_dir_recursive(staging_dir)
            return CAPTURE_STAGING_FAILED

        copy_ok = self._promote_staging_to_master(staging_dir, files_present)
        self._remove_dir_recursive(staging_dir)
        return CAPTURE_SUCCESS if copy_ok else CAPTURE_STAGING_FAILED

    def _copy_shared_files_to_staging(self, source_dir, staging_dir):
        """Copy SHARED_FILES from source_dir to staging_dir.

        Returns (file_hashes, file_sizes, files_present) or
        (None, None, []) when a copy fails so the caller can abort.
        """
        file_hashes = {}
        file_sizes = {}
        files_present = []
        for filename in SHARED_FILES:
            src = os.path.join(source_dir, filename)
            if not os.path.isfile(src):
                continue
            dst = os.path.join(staging_dir, filename)
            try:
                shutil.copy2(src, dst)
            except OSError:
                self._remove_dir_recursive(staging_dir)
                return None, None, []
            file_hashes[filename] = _sha256(dst)
            file_sizes[filename] = os.path.getsize(dst)
            files_present.append(filename)
        return file_hashes, file_sizes, files_present

    def _copy_shared_dirs_to_staging(self, source_dir, staging_dir, files_present):
        """Copy SHARED_DIRS from source_dir into staging_dir."""
        for dirname in SHARED_DIRS:
            src_sub = os.path.join(source_dir, dirname)
            if os.path.isdir(src_sub):
                self._copy_dir_recursive(src_sub, os.path.join(staging_dir, dirname))
                files_present.append(dirname)

    def _promote_staging_to_master(self, staging_dir, files_present):
        """Copy staged files into the master directory. Returns True on success."""
        copy_ok = True
        for fn in files_present:
            if fn in SHARED_FILES:
                s_file = os.path.join(staging_dir, fn)
                d_file = os.path.join(self.master_dir(), fn)
                if os.path.isfile(d_file):
                    self._set_file_readonly_windows(d_file, False)
                    try:
                        os.remove(d_file)
                    except OSError:
                        pass
                try:
                    shutil.copy2(s_file, d_file)
                except OSError:
                    copy_ok = False
            elif fn in SHARED_DIRS:
                self._copy_dir_recursive(
                    os.path.join(staging_dir, fn),
                    os.path.join(self.master_dir(), fn),
                )
        meta_src = os.path.join(staging_dir, METADATA_FILENAME)
        meta_dst = os.path.join(self.master_dir(), METADATA_FILENAME)
        if os.path.isfile(meta_dst):
            self._set_file_readonly_windows(meta_dst, False)
        try:
            shutil.copy2(meta_src, meta_dst)
        except OSError:
            copy_ok = False
        return copy_ok

    def copy_settings(self, source_dir, dest_dir):
        """Copy shared files/dirs from source_dir into dest_dir (merging dirs)."""
        if not source_dir or not os.path.isdir(source_dir):
            return False
        if not dest_dir:
            return False
        if not self._is_safe_path(source_dir, self._shared_dir, os.path.dirname(self._shared_dir)):
            return False
        try:
            os.makedirs(dest_dir, exist_ok=True)
        except OSError:
            return False

        any_copied = False
        for filename in SHARED_FILES:
            src = os.path.join(source_dir, filename)
            if not os.path.isfile(src):
                continue
            dst = os.path.join(dest_dir, filename)
            if os.path.isfile(dst):
                self._set_file_readonly_windows(dst, False)
                try:
                    os.remove(dst)
                except OSError:
                    pass
            try:
                shutil.copy2(src, dst)
                any_copied = True
            except OSError:
                pass

        for dirname in SHARED_DIRS:
            src_sub = os.path.join(source_dir, dirname)
            if os.path.isdir(src_sub):
                self._copy_dir_recursive(src_sub, os.path.join(dest_dir, dirname))

        return any_copied

    # ------------------------------------------------------------------ #
    # Refresh (source profile open)
    # ------------------------------------------------------------------ #

    def refresh_master_for_source(self, live_config_dir, source_profile_dir,
                                  source_dir_name, source_display_name):
        """Ensure the master snapshot is valid before the source profile launches."""
        with self._mutex:
            return self._refresh_master_for_source_unlocked(
                live_config_dir, source_profile_dir, source_dir_name, source_display_name
            )

    def _refresh_master_for_source_unlocked(self, live_config_dir, source_profile_dir,
                                            source_dir_name, source_display_name):
        source_valid = bool(source_profile_dir) and self.has_valid_settings(source_profile_dir)
        master_valid = self.has_valid_settings(self.master_dir())

        if source_valid:
            self._capture_master_snapshot_unlocked(
                source_profile_dir, source_dir_name, source_display_name
            )
            if live_config_dir:
                self.copy_settings(source_profile_dir, live_config_dir)
            return True

        if master_valid:
            if live_config_dir:
                self.copy_settings(self.master_dir(), live_config_dir)
            if source_profile_dir:
                self.copy_settings(self.master_dir(), source_profile_dir)
            return True

        if (live_config_dir and self.has_valid_settings(live_config_dir)
                and self._capture_master_snapshot_unlocked(
                    live_config_dir, source_dir_name, source_display_name
                ) == CAPTURE_SUCCESS):
            if source_profile_dir:
                self.copy_settings(live_config_dir, source_profile_dir)
            return True

        return False

    # ------------------------------------------------------------------ #
    # Apply
    # ------------------------------------------------------------------ #

    def apply_master_snapshot_to_league(self, league_config_dir, enforce_readonly=True):
        """Deploy the master snapshot into a League Config dir. Returns a result code string."""
        with self._mutex:
            return self._apply_master_snapshot_to_league_unlocked(league_config_dir, enforce_readonly)

    def _apply_master_snapshot_to_league_unlocked(self, league_config_dir, enforce_readonly):
        sync_enabled = bool(self._config.get(CONFIG_KEY_ENABLED, False))
        if not sync_enabled:
            return APPLY_SYNC_DISABLED

        if not league_config_dir or not os.path.isdir(league_config_dir):
            return APPLY_DEPLOY_FAILED
        if not self._is_safe_path(league_config_dir, os.path.dirname(self._shared_dir)):
            return APPLY_DEPLOY_FAILED

        source_info = self.resolve_source_profile()
        if not source_info["is_valid"]:
            return APPLY_SOURCE_MISSING

        expected_dir_name = source_info["directory_name"]
        source_path = source_info["profile_dir"]

        meta = self.get_snapshot_metadata()
        snapshot_source_dir = str(meta.get("source_directory", "") or "")

        if snapshot_source_dir != expected_dir_name or not self.has_valid_settings(self.master_dir()):
            capture_res = self._capture_master_snapshot_unlocked(
                source_path, expected_dir_name, source_info["display_name"]
            )
            if capture_res != CAPTURE_SUCCESS:
                return APPLY_SNAPSHOT_CORRUPT
            meta = self.get_snapshot_metadata()

        if str(meta.get("source_directory", "") or "") != expected_dir_name:
            return APPLY_HASH_MISMATCH

        file_hashes = meta.get("file_hashes", {}) or {}

        self._clear_readonly_for_deploy(league_config_dir)
        if not self._copy_files_to_league(league_config_dir):
            return APPLY_DEPLOY_FAILED
        self._copy_dirs_to_league(league_config_dir)
        if not self._verify_deployed_hashes(league_config_dir, file_hashes):
            return APPLY_HASH_MISMATCH
        if enforce_readonly:
            self._set_readonly_protection(league_config_dir)

        return APPLY_SUCCESS

    def _clear_readonly_for_deploy(self, league_config_dir):
        """Strip readonly flags before deploying new files."""
        for filename in SHARED_FILES:
            target_file = os.path.join(league_config_dir, filename)
            if os.path.isfile(target_file):
                self._set_file_readonly_windows(target_file, False)

    def _copy_files_to_league(self, league_config_dir):
        """Copy SHARED_FILES from master to league config dir. Returns True on success."""
        for filename in SHARED_FILES:
            src = os.path.join(self.master_dir(), filename)
            if not os.path.isfile(src):
                continue
            dst = os.path.join(league_config_dir, filename)
            if os.path.isfile(dst):
                self._set_file_readonly_windows(dst, False)
                try:
                    os.remove(dst)
                except OSError:
                    return False
            try:
                shutil.copy2(src, dst)
            except OSError:
                return False
        return True

    def _copy_dirs_to_league(self, league_config_dir):
        """Copy SHARED_DIRS from master to league config dir."""
        for dirname in SHARED_DIRS:
            src_dir = os.path.join(self.master_dir(), dirname)
            if os.path.isdir(src_dir):
                self._copy_dir_recursive(src_dir, os.path.join(league_config_dir, dirname))

    def _verify_deployed_hashes(self, league_config_dir, file_hashes):
        """Verify deployed file hashes match the snapshot. Returns True if all match."""
        for filename in file_hashes:
            if filename == FILE_ITEM_SETS:
                continue
            deployed_file = os.path.join(league_config_dir, filename)
            if not os.path.isfile(deployed_file):
                return False
            if _sha256(deployed_file) != str(file_hashes[filename]):
                return False
        return True

    def _set_readonly_protection(self, league_config_dir):
        """Mark shared files and dirs as readonly on Windows."""
        for filename in SHARED_FILES:
            protected_file = os.path.join(league_config_dir, filename)
            if os.path.isfile(protected_file):
                self._set_file_readonly_windows(protected_file, True)
        for dirname in SHARED_DIRS:
            protected_dir = os.path.join(league_config_dir, dirname)
            if os.path.isdir(protected_dir):
                self._set_dir_readonly_windows(protected_dir, True)

    def cleanup_readonly_flags(self, league_config_dir):
        if not league_config_dir or not os.path.isdir(league_config_dir):
            return
        for filename in SHARED_FILES:
            target = os.path.join(league_config_dir, filename)
            if os.path.isfile(target):
                self._set_file_readonly_windows(target, False)
        for dirname in SHARED_DIRS:
            target_dir = os.path.join(league_config_dir, dirname)
            if os.path.isdir(target_dir):
                self._set_dir_readonly_windows(target_dir, False)

    # ------------------------------------------------------------------ #
    # League directory discovery
    # ------------------------------------------------------------------ #

    def find_league_dir(self, riot_client_location=""):
        """Locate the League of Legends install dir via multiple robust sources."""

        from_installs = self._league_dir_from_installs_json()
        if from_installs:
            return from_installs

        from_metadata = self._league_dir_from_metadata_yaml()
        if from_metadata:
            return from_metadata

        from_registry = self._league_dir_from_registry()
        if from_registry:
            return from_registry

        rc_loc = riot_client_location
        if not rc_loc:
            rc_loc = str(self._config.get("RiotClientLocation", "") or "")
        if rc_loc:
            sibling = os.path.join(os.path.dirname(rc_loc.rstrip("/\\")), "League of Legends")
            if os.path.isdir(sibling):
                return sibling

        for drive in ["D:", "C:", "E:", "F:", "G:"]:
            candidate = f"{drive}/Riot Games/League of Legends"
            if os.path.isdir(candidate):
                return candidate

        return ""

    def _league_dir_from_installs_json(self):
        if not os.path.isfile(RIOT_INSTALLS_JSON):
            return ""
        try:
            with open(RIOT_INSTALLS_JSON, encoding="utf-8") as fh:
                data = json.load(fh)
        except (OSError, ValueError):
            return ""
        if not isinstance(data, dict):
            return ""
        associated = data.get("associated_client", {})
        if isinstance(associated, dict):
            for path_key in associated:
                p_str = str(path_key).rstrip("/\\")
                if p_str.lower().endswith("league of legends") and os.path.isdir(p_str):
                    return p_str
        return ""

    def _league_dir_from_metadata_yaml(self):
        if not os.path.isfile(RIOT_METADATA_YAML):
            return ""
        try:
            with open(RIOT_METADATA_YAML, encoding="utf-8") as fh:
                for line in fh:
                    line = line.strip()
                    if line.startswith("product_install_full_path:"):
                        path = line.split(":", 1)[1].strip()
                        path = path.strip("\"'")
                        if os.path.isdir(path):
                            return path
        except OSError:
            return ""
        return ""

    def _league_dir_from_registry(self):
        if not _WIN:
            return ""
        for reg_key in REG_KEYS:
            directory = self._query_registry_install_location(reg_key)
            if directory:
                return directory
        return ""

    @staticmethod
    def _query_registry_install_location(reg_key):
        """Query a single registry key for InstallLocation. Returns the path or ''."""
        try:
            proc = subprocess.run(
                ["reg", "query", reg_key, "/v", "InstallLocation"],
                capture_output=True, text=True, timeout=15,
            )
        except (OSError, subprocess.TimeoutExpired):
            return ""
        if proc.returncode != 0:
            return ""
        for line in proc.stdout.splitlines():
            if "InstallLocation" in line and "REG_SZ" in line:
                parts = line.split("REG_SZ", 1)
                if len(parts) >= 2:
                    directory = parts[1].strip()
                    if os.path.isdir(directory):
                        return directory
        return ""

    def league_config_dir(self, league_dir):
        return os.path.join(league_dir, "Config")
