"""Constants shared by the Deceive / Appear Offline presence-masking stack.

Mirrors the Godot PresenceConstants (src/presence/presence_constants.gd).
"""

# Configuration key stored in configs.json for Appear Offline toggle.
CONFIG_KEY_APPEAR_OFFLINE = "AppearOffline"

# Loopback address for local proxies.
LOCALHOST_IP = "127.0.0.1"

# Deceive public DNS domain resolving to 127.0.0.1 for SSL host validation.
DECEIVE_LOCALHOST_DOMAIN = "deceive-localhost.molenzwiebel.xyz"

# Official upstream Riot client configuration endpoint.
RIOT_CLIENT_CONFIG_BASE_URL = "https://clientconfig.rpg.riotgames.com"

# Default Riot XMPP chat port over TLS.
DEFAULT_RIOT_CHAT_PORT = 5223

# Stream buffer sizes.
BUFFER_SIZE = 16384

# Process watchdog interval in seconds.
PROCESS_POLL_INTERVAL_SEC = 2.0
