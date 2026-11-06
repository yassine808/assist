# Contributing

RiotSwitcher is small on purpose: swap Riot Client session files, nothing else.

## Setup

Requirements: Windows, Node 22.22+, Python 3.9+.

```powershell
npm install
npm run dev
```

`npm run dev` starts Electron, which spawns the Python backend itself. Do not
run `npm run dev:python` at the same time — two backends on one data directory
corrupt `profiles_data.json`.

## Before you open a pull request

Run the same gate CI runs:

```powershell
npm run typecheck
npm run lint
npm run test
npm run test:py
npm run check:api-leaks
npm run build
```

## Rules

- **Riot Client files only.** Never write into a VALORANT install, never touch
  Vanguard, memory, or game traffic. `tests/test_file_safety.py` enforces it.
- Python stays **3.9-compatible**, backend modules stay flat files under
  `src/backend`.
- New IPC method: add it to `_build_handlers()` in `src/backend/main.py` and
  call it with `useIPC().call("method", params)`.
- Do not weaken or delete a test to get a green build.
- `.env` holds API keys; it is gitignored and must never be committed.

## Layout

| Path | What lives there |
|---|---|
| `src/main` | Electron main process: window, tray, updater, Python bridge |
| `src/preload` | `contextBridge` API for the renderer |
| `src/renderer` | React 19 + Tailwind UI |
| `src/backend` | Python backend (flat modules) |
| `tests` | pytest suites |
| `docs/ARCHITECTURE.md` | Protocol and flow reference |

## Commits

Small, focused commits with a plain subject line. Describe *why* in the body
when it is not obvious.

## License

By contributing you agree your work is released under GPL-3.0-or-later.
