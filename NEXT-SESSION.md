# Next Session — RiotSwitcher Electron Rewrite Handoff

**Date:** 2026-09-03
**Repo:** `D:\Projects\Assist` → `git@github.com:yassine808/assist.git` (origin)
**Branch:** `main` (fully synced with `origin/main`). Feature branch `feature/enhanced-profile-cards` was fast-forward merged into `main` and pushed. Both branches are in sync.

## State Summary

The Godot → Electron + React + TypeScript + Python-backend rewrite is **functionally complete and merged to `main`**. All 14 steps in `plans/electron-rewrite.md` are marked `[x]` and verified:

- TypeScript typecheck clean (`npm run typecheck`)
- Backend `py_compile` clean (all `.py` files)
- `electron-vite build` produces `out/main|preload|renderer`
- PyInstaller bundle `release/python/main.exe` builds and responds over IPC
- `electron-builder --dir` produced `release/win-unpacked/RiotSwitcher.exe` with bundled Python
- Dev-mode backend smoke test passed (IPC: `backend_ready`, `get_profiles`, `get_config`, account detection start/stop)
- Working tree clean; all commits pushed to `main`

## Remaining / Optional Tasks (pick any, all are non-blocking)

### 1. Run the full installer build: `npm run dist`
Only `electron-builder --dir` (unpacked dir) has been exercised — i.e. `npm run build && npm run build:py` then `electron-builder --dir`. The full NSIS installer artifact via `electron-builder` (no `--dir`) has **never been produced**.

```
npm run dist
```

Expected output: `release/RiotSwitcher Setup x.x.x.exe` (NSIS, oneClick:false, per-user, allowToChangeInstallationDirectory). Verify it launches and finds the bundled `resources/python/main.exe`.

**If this fails**, likely causes, in order of likelihood:
- Missing signtool cert / code-signing env (default behavior attempts signing; may need to disable or accept warning).
- `extraResources` / `asarUnpack` path mismatch: `electron-builder.yml` copies `release/python` → `resources/python`, and `python-bridge.ts` relies on `process.resourcesPath/python/main.exe` when `app.isPackaged`. Confirm the unpacked `resources/python/main.exe` exists after build.

### 2. Interactive QA via `npm run dev`
Backend was only smoke-tested headlessly over IPC. Needs human/GUI validation:
- Launch: `npm run dev` (spawns electron + python backend with `--dev`, data dir `D:\Projects\Assist\data`).
- Exercise: Add Account flow (`/add-account`, real Riot login detection), launch/stop a profile, Settings view (`/settings`) toggles + Language + LaunchProduct dropdown, system tray (close-to-tray, minimize-to-tray), and single-instance lock (launching a 2nd instance should focus the 1st).
- Do NOT call backend `kill_all`, `save_session`, `restore_session` in tests — they touch real Riot processes/session files.

### 3. Update README with build/packaging instructions
README was rewritten during Step 1 scaffolding but currently lacks dev/build/install docs. Recommend adding:
- Prerequisites (Node 20+, Python 3.11+, `pip install cryptography pyinstaller`)
- Dev: `npm run dev`
- Build: `npm run build:py` then `npm run dist`
- Output artifacts: `release/python/main.exe` (backend), `release/win-unpacked/` (unpacked), `release/RiotSwitcher Setup *.exe` (installer)
- Data dir: dev → `D:\Projects\Assist\data`, packaged → `%APPDATA%\RiotSwitcher`

## Remaining Steps — Detailed Runbook

Ordered checklist for the next session. Steps 0 is already DONE (included for context/verification). Steps 1–3 are the remaining work.

### Step 0 — [DONE] Confirm merged baseline
- [x] `git status -sb` → `## main...origin/main` (clean, synced)
- [x] `git log --oneline -1` → `aa13ffd Cleanup: drop unused electron-store dep and China-specific electron mirror`

Verify before starting fresh work:
```
git status -sb
git log --oneline -3
```
Expected: clean tree, `main` == `origin/main` at `aa13ffd` or later.

### Step 1 — Build the full NSIS installer  (remaining)
1. `npm run typecheck` → must pass (0 errors) before any build.
2. `npm run build` → produces `out/main`, `out/preload`, `out/renderer`. Verify all three exist.
3. `npm run build:py` → PyInstaller COLLECT → `release/python/main.exe`. Verify file exists.
4. `npm run dist` → runs `build` + `build:py` + `electron-builder` (note: `dist` also re-runs 2 & 3; the manual runs above are just pre-checks).
5. **Gate:** verify `release/RiotSwitcher Setup x.x.x.exe` exists.
6. **Gate:** verify `release/win-unpacked/resources/python/main.exe` exists (extraResources + asarUnpack path).
7. **Gate:** launch the installed app; confirm it starts the Python backend (log shows `backend_ready`) and persists to `%APPDATA%\RiotSwitcher`.

**On failure** (most→least likely):
- Signing: signtool/cert env missing. Accept warning or disable signing, then retry.
- Path mismatch: `electron-builder.yml` copies `release/python` → `resources/python`; `python-bridge.ts` uses `process.resourcesPath/python/main.exe` when packaged. Reconfirm after each build that the bundle landed where the bridge expects.
- `data/` pollution: if a dev `data/` dir exists at repo root, `Remove-Item -Recurse -Force "data"` before committing.

### Step 2 — Interactive QA via `npm run dev`  (remaining)
1. `npm run dev` (spawns electron + `python src/backend/main.py --dev`, data dir `D:\Projects\Assist\data`).
2. Verify backend spawns: renderer shows profile grid (empty state) without console errors; dev backend log line `[backend] ready, data_dir=...`.
3. **Settings (`/settings`):** toggle Appear Offline, Close/Minimize to Tray, SyncGameSettings; pick Language + LaunchProduct via dropdowns; reopen settings to confirm persistence through `get_config`.
4. **Add Account (`/add-account`):** Start Detection → it spawns Riot client + polls login → on real login auto-creates a profile via `_next_profile_name` and emits `profile_created`. Cancel path also works.
5. **Profile launch/stop:** from Home, launch a profile → progress UI updates via `useProfileLaunch`; stop returns cleanly. Do NOT invoke backend `kill_all`/`save_session`/`restore_session` directly in tests.
6. **Tray:** close window → hides to tray (if `CloseToTray`); from tray icon → Show restores, Exit quits. Minimize → tray if `MinimizeToTray`.
7. **Single-instance:** launch a 2nd `npm run dev`/app instance → should focus the existing window, not open a second.
8. **Cleanup:** Ctrl+C to stop; `Remove-Item -Recurse -Force "data"` before any commit.

### Step 3 — Update README with build/packaging docs  (remaining)
Add to `README.md`:
1. **Prerequisites:** Node 20+, Python 3.11+, `pip install cryptography pyinstaller`.
2. **Dev run:** `npm run dev` (and note data dir → `D:\Projects\Assist\data`).
3. **Build backend:** `npm run build:py` → `release/python/main.exe`.
4. **Build installer:** `npm run dist` → `release/RiotSwitcher Setup *.exe`.
5. **Artifacts:** `release/python/main.exe` (backend), `release/win-unpacked/` (unpacked), `release/RiotSwitcher Setup *.exe` (installer).
6. **Packaged data dir:** `%APPDATA%\RiotSwitcher` (vs dev `D:\Projects\Assist\data`).
7. Commit README + `NEXT-SESSION.md` (add files individually; do NOT `git add .`).

---

## Important Technical Notes (read before touching anything)

- **IPC protocol reserves `stdout` for JSON lines** (`src/backend/protocol.py`). ALL backend logging must go to stderr (`sys.stderr.write`) — NEVER `print()`. Deceive modules are patched with a module-level `print` override to redirect to stderr. Do not regress this.
- **Dev vs packaged backend paths** (`src/main/python-bridge.ts`): dev spawns `python src/backend/main.py --dev`; packaged spawns `release/python/main.exe` with no `--dev` and uses `%APPDATA%\RiotSwitcher`. Honors `RIOTSWITCHER_BACKEND` env override.
- **Token names** (Tailwind, `tailwind.config.ts`): `bg-dark:#0f0f12`, `bg-card:#1a1a20`, `riot-red:#ff4655`, `riot-redDark:#d32f2f`, `rank.gold/silver/bronze`, font `Inter`.
- **Git hygiene (Windows/PowerShell)**: `Remove-Item -Recurse -Force "data"` before committing (dev data is gitignored but shouldn't ship). PowerShell has NO `&&` and NO `grep` (use `Select-String`). PowerShell stderr noise from `git push` is cosmetic — the push succeeds. Do NOT use `git add .`; add files individually.
- **PyInstaller on Windows**: `src/backend/*.py` glob does NOT expand in PowerShell for `py_compile` — pass explicit file list (e.g. `Get-ChildItem` + `@files` splatting). `build/build-python.spec` uses `collect_submodules`+`collect_data_files` for the only third-party dep, `cryptography`.
- **`useIPC` hook**: `call<T>(method, params?)` and `onEvent(event, handler)` returning unsubscribe — wrap `useEffect` cleanup as `() => { unsub?.(); }` (TS Destructor error otherwise).
- **Tray/window behavior** (`src/main/tray.ts`, `src/main/window.ts`, `src/main/index.ts`): single-instance via `app.requestSingleInstanceLock()`; `close`/`minimize` hide to tray per backend config (`CloseToTray`/`MinimizeToTray`); `second-instance` focuses/recreates the window.

## Key Files

- Frontend views: `src/renderer/src/views/HomeView.tsx`, `AddAccountView.tsx`, `SettingsView.tsx`
- Hooks: `src/renderer/src/hooks/useIPC.ts`, `useProfileLaunch.ts`, `useAccountDetection.ts`
- Main process: `src/main/index.ts`, `tray.ts`, `window.ts`, `python-bridge.ts`, `preload.ts`
- Backend: `src/backend/main.py` (orchestrator), `config_manager.py`, `profile_manager.py`, `session_manager.py`, `launch_orchestrator.py`, `account_detector.py`, and `src/backend/deceive/*` (Appear Offline proxy), `league_settings_sync.py`, `valorant_tracker.py`, `henrik_client.py`, `riot_client.py`
- Packaging: `build/build-python.spec`, `build/icon.ico`, `build/icon.png`, `electron-builder.yml`, `package.json` (scripts: `dev`, `build`, `build:py`, `dist`, `typecheck`)

## Definition of Done (session complete when all true)

- [x] `npm run typecheck` passes (0 errors)
- [x] `npm run dist` produces `release/RiotSwitcher Setup 2.0.0.exe` and launches with bundled `resources/python/main.exe`
- [ ] `npm run dev` interactive QA passed: Settings persistence, Add Account (real login), profile launch/stop, tray, single-instance
- [x] README updated with prereqs / dev / build / artifacts / data-dir docs
- [x] Working tree clean; no stray `data/` at repo root; `main` pushed and synced with `origin/main`

