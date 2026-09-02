"""Outbound XMPP presence filtering.

Mirrors the Godot XmppFilter (src/presence/xmpp_filter.gd): strips or
suppresses <presence> stanzas flowing from the client to the Riot chat server
so the user appears offline while chat and system packets pass through intact.
"""

import re

from . import presence_constants as pc  # noqa: F401  (kept for parity)

import sys


def print(*args, **kwargs):  # noqa: A001  route logs to stderr; stdout carries the IPC channel
    sys.stderr.write(' '.join(str(a) for a in args) + '\n')
    sys.stderr.flush()


# Matches <presence ...>...</presence> or self-closing <presence .../>.
_PRESENCE_REGEX = re.compile(
    r"<presence\b[^>]*>(?:(?!</presence>).)*?</presence>|<presence\b[^>]*/>",
    re.DOTALL,
)

# Replacement used for a directed/non-available presence stanza.
_UNAVAILABLE = "<presence type='unavailable'/>"


def filter_outbound(data: bytes) -> bytes:
    """Suppress presence stanzas in a raw XMPP outbound chunk.

    Returns the modified bytes. If no presence stanza is present the input is
    returned unchanged (byte-for-byte), matching the Godot fast path.
    """
    if not data:
        return data

    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return data

    if not text or "<presence" not in text:
        return data

    matches = list(_PRESENCE_REGEX.finditer(text))
    if not matches:
        return data

    # Rebuild by replacing each matched stanza in reverse order.
    modified = text
    for m in reversed(matches):
        match_str = m.group(0)
        if "type='unavailable'" in match_str:
            replacement = match_str  # already unavailable, keep
        else:
            replacement = _UNAVAILABLE
        modified = modified[: m.start()] + replacement + modified[m.end():]

    print(f"[Presence/XMPP] Filtered {len(matches)} presence stanza(s) from outbound stream.")
    return modified.encode("utf-8")
