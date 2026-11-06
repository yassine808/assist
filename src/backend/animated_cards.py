"""Local catalogue of animated player cards.

The animated cards ship with the app as APNG files and are served to the
renderer over the privileged ``card://`` scheme by the Electron main process.
The backend only needs the folder to pick a random file and build the same URL
the renderer already uses, so a freshly created profile can start with an
animated card instead of waiting for the remote catalogue.

The folder arrives through ``RIOTSWITCHER_ANIMATED_CARDS_DIR`` (set by the
Electron main process) because its path differs between a dev checkout and a
packaged build. When the variable is missing or the folder is unreadable the
helpers return an empty result and the caller falls back to a static card.
"""

import os
import secrets
import urllib.parse

ENV_DIR = "RIOTSWITCHER_ANIMATED_CARDS_DIR"
CARD_SCHEME = "card"
CARD_HOST = "animated"
CARD_EXTENSION = ".apng"


def card_dir():
    """Folder set by the Electron main process, or '' when unavailable."""
    return os.environ.get(ENV_DIR, "")


def list_card_urls():
    """Return one ``card://animated/<file>`` URL per installed APNG, sorted."""
    directory = card_dir()
    if not directory or not os.path.isdir(directory):
        return []
    try:
        names = os.listdir(directory)
    except OSError:
        return []

    urls = [
        f"{CARD_SCHEME}://{CARD_HOST}/{urllib.parse.quote(name)}"
        for name in names
        if name.lower().endswith(CARD_EXTENSION)
    ]
    return sorted(urls)


def random_card_url():
    """Return a random installed animated card URL, or '' when none exist."""
    urls = list_card_urls()
    if not urls:
        return ""
    return secrets.choice(urls)
