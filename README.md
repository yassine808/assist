# Riot Switcher

**⚠️ IMPORTANT SECURITY NOTICE:**

**Always download Riot Switcher ONLY from the official source.**  
**Do NOT trust unknown links or unofficial websites.**  
Downloading from untrusted sources may compromise your computer's security.

---

**Riot Switcher** is a desktop launcher for managing multiple Riot Games accounts (VALORANT and League of Legends) in a simple, fast, and organized way. Switch accounts with a single click, view per-account rank/stats, and keep your game settings in sync across profiles.

## Features

- **Profile Management** — Save multiple Riot accounts as profiles; switch between them with one click.
- **Rank & Stats** — View per-profile VALORANT rank, RR, peak rank, W/L record, top agent, and average combat score (via HenrikDev API).
- **Session Switch** — Capture local credentials and swap session files so the Riot Client opens into the chosen account automatically.
- **League Settings Sync** — Share game settings (hotkeys, video, audio, smartcast) across profiles via a single validated master snapshot.
- **Appear Offline** — Deceive-style XMPP presence proxy so you can show as offline while playing.
- **Vanguard Control** — Basic Riot Vanguard (vgc) service control.
- **System Tray** — Minimize to tray, close to tray.

## Architecture

```
┌─────────────────────────────────┐
│  Electron Main Process (Node.js)│
│  - Window management            │
│  - IPC bridge (Python ↔ React)  │
└────────┬───────────────┬────────┘
         │ IPC           │ spawn + JSON-line stdio
┌────────▼────────┐  ┌───▼──────────────────┐
│ React Renderer  │  │ Python Backend        │
│ (TypeScript +   │  │ - HenrikDev API       │
│  Tailwind CSS)  │  │ - Profile CRUD        │
│ - Profile Grid  │  │ - Riot Client mgmt    │
│ - Settings UI   │  │ - Session file swap   │
│ - Add Account   │  │ - Settings sync       │
│ - Glow Cards    │  │ - Process detect      │
│ - System Tray   │  │ - Deceive proxy       │
└─────────────────┘  └───────────────────────┘
```

The Electron main process spawns the Python backend as a child process and communicates over stdin/stdout using one JSON object per line. The React renderer talks to Electron over IPC.

## Requirements

- Windows 10/11
- Node.js 18+ (development)
- Python 3.10+ (development)
- Installed Riot Games Client
- A HenrikDev API key for rank/stats (place in `.env` as `HENRIKDEV_API_KEY=HDEV-...`)

## Development

```bash
npm install
npm run dev
```

- `npm run dev` — starts Electron (Vite dev server), React renderer, and the Python backend.
- `npm run typecheck` — TypeScript type checking.
- `npm run build` — builds the main, preload, and renderer bundles into `out/`.

## Building a Release

```bash
npm run dist
```

This builds the frontend, packages the Python backend into a standalone executable (PyInstaller), and produces a Windows NSIS installer via electron-builder.

## Usage

1. **Add an account** — Click "Add Account"; the app opens the Riot Client, detects the signed-in account, and auto-creates a profile.
2. **Switch** — Click the play button on a profile; the app kills processes, swaps session files, and relaunches the client into that account.
3. **Stay signed in** — When logging into the Riot Client, check **"Stay signed in"** so automatic login works.

## License and Disclaimer

This is a personal project created for educational and organizational purposes only.

**Riot Switcher is not affiliated, associated, authorized, endorsed by, or in any way officially connected with Riot Games, Inc., or any of its subsidiaries or affiliates.**

All product and company names are trademarks™ or registered® trademarks of their respective holders. The use of these names, logos, and brands does not imply endorsement.

**Use of Riot Switcher is at your own risk. The developer does not take responsibility for any consequences, including penalties or bans, resulting from its use.**
