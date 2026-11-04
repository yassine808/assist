# AGENTS.md — RiotSwitcher

Electron + React + Python desktop app that switches between Riot accounts by
swapping **Riot Client** session files. Nothing else.

## Architecture

```
src/
  main/        Electron main process (TypeScript)
    index.ts       app lifecycle, single-instance lock, tray
    window.ts      BrowserWindow creation (main + secondary views)
    python-bridge.ts  spawns the Python backend, JSON-line IPC
  preload/     contextBridge API exposed to the renderer
  renderer/    React 19 + Tailwind UI (src/views, src/components, src/hooks)
  backend/     Python 3.9 backend, modules are flat (no package nesting)
    main.py             entry point, handler table, wiring
    profile_manager.py  profiles_data.json
    session_manager.py  saves/restores Riot Client session files
    account_detector.py "Add Account" polling thread
    riot_client.py      locate/kill/launch the Riot Client
    riot_processes.py   process table helpers
    valorant_tracker.py HenrikDev API rank/stats refresh
    deceive/            optional "Appear Offline" proxy stack
tests/        pytest suites
```

Three processes: Electron main ↔ Python backend over JSON lines on
stdin/stdout ↔ React renderer over `contextBridge` IPC.

## Commands

```powershell
npm run dev          # electron-vite + python backend (dev data dir: .\data)
npm run typecheck    # tsc for main + renderer
npm run lint         # eslint
npm run test         # vitest
npm run test:py      # pytest
npm run build        # electron-vite production build
python -m ruff check src/backend tests/
python -m compileall -q src/backend tests
```

Full pre-commit gate: `typecheck`, `lint`, `test`, `test:py`, `ruff`,
`compileall`, `build`.

## Conventions

- Python must stay **3.9-compatible** (no `match`, no `X | Y` runtime types).
- Backend modules are flat files under `src/backend`; import them as top-level
  modules (`import session_manager`), not as a package.
- New IPC method: add it to the dict in `_build_handlers()` (`main.py`) and call
  it from the renderer with `useIPC().call("method", params)`. Backend → UI
  notifications go through `protocol.send_event(name, data)` and
  `useIPC().onEvent(name, cb)`.
- React: function components + hooks, Tailwind utility classes, no new npm
  dependency without asking.
- Tests: pytest in `tests/`, Vitest colocated as `*.test.ts(x)`. Do not weaken
  or delete a test to get green.
- Ruff line length 120; `E501` is ignored for `protocol.py` and `deceive/`.

## Hard invariants

- The app may only read/write **Riot Client** files:
  `%LOCALAPPDATA%\Riot Games\Riot Client\{Data,Config}` and the client's own
  install `Config` folder. It must never write into a **VALORANT** install,
  never touch Vanguard, memory, or game traffic.
- `tests/test_file_safety.py` enforces this. A change that adds a game path
  write must be rejected, not accommodated.
- League settings sync (`league_settings_sync.py`) is the only module allowed
  to touch League config, and only when `SyncGameSettings` is on (default off).

## Data & environment

- Dev app data: `data/` (gitignored). Electron userData:
  `%APPDATA%\riotswitcher`.
- Deleting app data requires the app to be fully stopped first, and only one
  backend process may run: two backends writing `profiles_data.json.tmp`
  cause `WinError 32` on `os.replace`.
- `.env` holds API keys and is gitignored; never commit it.
- Riot Client files under `%LOCALAPPDATA%\Riot Games\Riot Client` are the
  user's live login. Do not delete them unless the user asks.
