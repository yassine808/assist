"""Per-profile Riot Client session file management.

The Riot Client stores its login/session state in a small set of files and
directories under the user's LOCALAPPDATA and the install directory. To switch
profiles (accounts), the app saves these files into a per-profile backup
directory and restores them from that backup, replacing the live files.

Every file replacement is *temp-then-rename*: a copy is written to a temp
sibling and swapped into place only after it fully succeeds, so a failed or
interrupted operation never destroys the previous good backup or leaves the
live client files in a half-written state.

This mirrors the original Godot ``ProfileManager.save/restore_profile_session``
semantics (see FILES_TO_SWITCH), including the deliberate exclusion of the
transient ``lockfile``.

Thread-safety: a single reentrant mutex guards all filesystem operations so
concurrent save/restore calls from the job worker and protocol loop cannot
interleave.
"""

import os
import re
import shutil
import threading

# Riot Client files that carry login/session state and must be swapped per
# profile. NOTE: "lockfile" is intentionally excluded — it is transient and
# restoring a stale one breaks the client.
FILES_TO_SWITCH = [
    {
        "id": "private_settings",
        "filename": "RiotGamesPrivateSettings.yaml",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Data/RiotGamesPrivateSettings.yaml",
    },
    {
        "id": "sessions_dir",
        "filename": "Sessions",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Data/Sessions",
        "is_dir": True,
    },
    {
        "id": "riot_client_settings",
        "filename": "RiotClientSettings.yaml",
        "base": "local_app_data",
        "rel_path": r"Riot Games/Riot Client/Config/RiotClientSettings.yaml",
    },
    {
        "id": "client_config",
        "filename": "client.config.yaml",
        "base": "install_dir",
        "rel_path": r"Config/client.config.yaml",
    },
    {
        "id": "client_settings",
        "filename": "client.settings.yaml",
        "base": "install_dir",
        "rel_path": r"Config/client.settings.yaml",
    },
]

DIR_TMP_SUFFIX = "_tmp"
FILE_TMP_SUFFIX = ".tmp"


def sanitize_directory_name(name):
    """Produce a filesystem-safe directory name from a profile name.

    Mirrors the legacy sanitizer: keeps alphanumerics and spaces, replaces
    other characters with underscores, trims and collapses whitespace.
    """
    cleaned = re.sub(r"[^A-Za-z0-9 _\-]", "_", name or "")
    cleaned = re.sub(r"\s+", " ", cleaned).strip()
    cleaned = cleaned.replace(" ", "_")
    return cleaned or "profile"


class SessionManager:
    """Owns session file backups per profile and swaps them in/out atomically."""

    def __init__(self, profiles_root):
        """profiles_root: directory that will hold each profile's backup folder."""
        self._root = profiles_root
        self._lock = threading.RLock()

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def save_session(self, directory_name, riot_install_dir):
        """Copy the current live Riot Client files into a profile's backup dir.

        Returns True only if every present source file was backed up. Files
        that do not exist at the source are silently skipped (the profile's
        backup then simply lacks them).
        """
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            os.makedirs(profile_dir, exist_ok=True)
            all_success = True
            for file_def in FILES_TO_SWITCH:
                source = self._resolve_path(file_def, riot_install_dir)
                if not source:
                    continue
                dest = os.path.join(profile_dir, file_def["filename"])
                if file_def.get("is_dir"):
                    if not os.path.isdir(source):
                        continue
                    if self._copy_dir_atomic(source, dest) != 0:
                        all_success = False
                else:
                    if not os.path.isfile(source):
                        continue
                    if self._copy_file_atomic(source, dest) != 0:
                        all_success = False
        return all_success

    def restore_session(self, directory_name, riot_install_dir):
        """Write a profile's backed-up files over the live Riot Client files.

        Files the profile never backed up are removed from the live client so
        no stale session data survives. Every replacement is temp-then-rename,
        so a failed restore leaves the live client files intact. Returns True
        only if every restore succeeded.
        """
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            all_success = True
            for file_def in FILES_TO_SWITCH:
                dest = self._resolve_path(file_def, riot_install_dir)
                if not dest:
                    continue
                os.makedirs(os.path.dirname(dest), exist_ok=True)
                source = os.path.join(profile_dir, file_def["filename"])
                if file_def.get("is_dir"):
                    if os.path.isdir(source):
                        if self._copy_dir_atomic(source, dest) != 0:
                            all_success = False
                    elif os.path.isdir(dest):
                        if self._remove_dir_recursive(dest) != 0:
                            all_success = False
                else:
                    if os.path.isfile(source):
                        if self._copy_file_atomic(source, dest) != 0:
                            all_success = False
                    elif os.path.isfile(dest):
                        if not self._remove_file(dest):
                            all_success = False
        return all_success

    def delete_profile_dir(self, directory_name):
        """Remove a profile's backup directory."""
        profile_dir = self._profile_dir(directory_name)
        with self._lock:
            if os.path.isdir(profile_dir):
                self._remove_dir_recursive(profile_dir)
            return not os.path.isdir(profile_dir)

    def profile_dir(self, directory_name):
        return self._profile_dir(directory_name)

    # ------------------------------------------------------------------
    # Path resolution
    # ------------------------------------------------------------------

    def _profile_dir(self, directory_name):
        return os.path.join(self._root, sanitize_directory_name(directory_name))

    @staticmethod
    def _resolve_path(file_def, riot_install_dir):
        base = file_def.get("base")
        rel = file_def["rel_path"]
        if base == "local_app_data":
            local = os.environ.get("LOCALAPPDATA", "")
            if not local:
                return ""
            return os.path.join(local, *rel.split("/"))
        if base == "install_dir":
            if not riot_install_dir:
                return ""
            return os.path.join(riot_install_dir, *rel.split("/"))
        return ""

    # ------------------------------------------------------------------
    # Atomic helpers
    # ------------------------------------------------------------------

    def _copy_file_atomic(self, source_path, dest_path):
        tmp_path = dest_path + FILE_TMP_SUFFIX
        if os.path.isfile(tmp_path):
            os.remove(tmp_path)
        try:
            shutil.copy2(source_path, tmp_path)
        except OSError:
            return 1
        if os.path.isfile(dest_path):
            try:
                os.remove(dest_path)
            except OSError:
                return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        try:
            shutil.copy2(tmp_path, dest_path)
            os.remove(tmp_path)
            return 0
        except OSError:
            return 1

    def _copy_dir_atomic(self, source_path, dest_path):
        tmp_path = dest_path + DIR_TMP_SUFFIX
        if os.path.isdir(tmp_path):
            self._remove_dir_recursive(tmp_path)
        if self._copy_dir_recursive(source_path, tmp_path) != 0:
            self._remove_dir_recursive(tmp_path)
            return 1
        if os.path.isdir(dest_path):
            if self._remove_dir_recursive(dest_path) != 0:
                return 1
        if self._rename_with_retry(tmp_path, dest_path) == 0:
            return 0
        if self._copy_dir_recursive(tmp_path, dest_path) == 0:
            self._remove_dir_recursive(tmp_path)
            return 0
        return 1

    @staticmethod
    def _rename_with_retry(old_path, new_path):
        for _ in range(3):
            try:
                os.rename(old_path, new_path)
                return 0
            except OSError:
                import time
                time.sleep(0.1)
        return 1

    @staticmethod
    def _copy_dir_recursive(source_path, dest_path):
        try:
            shutil.copytree(source_path, dest_path, dirs_exist_ok=True)
            return 0
        except OSError:
            return 1

    @staticmethod
    def _remove_dir_recursive(path):
        for _ in range(3):
            try:
                shutil.rmtree(path, ignore_errors=True)
                if not os.path.exists(path):
                    return 0
            except OSError:
                pass
            import time
            time.sleep(0.1)
        return 0 if not os.path.exists(path) else 1

    @staticmethod
    def _remove_file(path):
        """Remove a file, returning True if it is gone (or was never there)."""
        for _ in range(3):
            try:
                if os.path.isfile(path):
                    os.remove(path)
                return not os.path.exists(path)
            except OSError:
                import time
                time.sleep(0.1)
        return not os.path.exists(path)
