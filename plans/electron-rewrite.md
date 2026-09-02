# Blueprint: Rewrite RiotSwitcher from Godot to Electron + React + Python

## Objective
Rewrite the Godot (GDScript) Valorant account manager "RiotSwitcher" into an Electron app with a React + TypeScript frontend and a Python backend for system-level tasks (API calls, process management, file I/O, settings sync).

## Architecture

```
┌─────────────────────────────────┐
│  Electron Main Process (Node.js)│
│  - Window management            │
│  - IPC bridge (Python ↔ React)  │
│  - App lifecycle                │
└────────┬───────────────┬────────┘
         │ IPC           │ IPC (spawn + stdio JSON)
┌────────▼────────┐  ┌───▼──────────────────┐
│ React Renderer  │  │ Python Child Process  │
│ (TypeScript +   │  │ (Backend)             │
│  Tailwind CSS)  │  │ - HenrikDev API       │
│                 │  │ - Profile CRUD        │
│ - Profile Grid  │  │ - Riot Client mgmt    │
│ - Settings UI   │  │ - Session file swap   │
│ - Add Account   │  │ - Settings sync       │
│ - Glow Cards    │  │ - Process detect      │
│ - System Tray   │  │ - Deceive proxy       │
│ - View Routing  │  │ - Registry / paths    │
└─────────────────┘  └───────────────────────┘
```

### IPC Protocol
Python child process communicates via stdin/stdout JSON lines:
- **Request**: `{"id": 1, "method": "get_profiles", "params": {}}`
- **Response**: `{"id": 1, "result": {...}}`
- **Event**: `{"event": "valorant_data_updated", "params": {"profile_name": "..."}}`

Electron main process spawns Python, bridges IPC to renderer via `ipcMain.handle()` / `ipcMain.on()`.

---

## Step 1: Project Scaffolding

**Goal**: Empty Electron + React + Python skeleton that boots and shows a blank window.

**Tasks**:
- Initialize npm project with `package.json`
- Set up Electron main process (`src/main/index.ts`) with BrowserWindow
- Set up React renderer with Vite + TypeScript + Tailwind CSS (`src/renderer/`)
- Set up Python backend entry point (`src/backend/main.py`) with basic JSON-line stdio protocol
- Create `electron.vite.config.ts` or equivalent Vite-Electron integration
- Add `concurrently` script to run Electron + Python in dev mode
- Configure `electron-builder` for packaging (include Python subprocess)
- Create `.gitignore`, `tsconfig.json`, `tailwind.config.ts`

**Verification**: `npm run dev` boots Electron, shows blank React app, Python process starts and responds to `{"method": "ping"}`.

**Files**:
```
package.json
tsconfig.json
tailwind.config.ts
src/main/index.ts
src/main/python-bridge.ts
src/renderer/index.html
src/renderer/src/main.tsx
src/renderer/src/App.tsx
src/renderer/src/index.css
src/backend/main.py
src/backend/protocol.py
```

---

## Step 2: Python Backend — Profile Manager

**Goal**: Python backend that can create, read, update, delete, and list profiles. Persists to `profiles_data.json`.

**Tasks**:
- Implement `ProfileManager` class in Python with JSON persistence
- Profile data model matching Godot's structure:
  ```python
  {
      "profile_name": str,
      "description": str,
      "valorant_puuid": str,
      "valorant_region": str,
      "valorant_in_game_name": str,
      "valorant_data": {
          "tier": int,
          "rank_name": str,
          "rr": int,
          "peak_rank_name": str,
          "wins": int,
          "losses": int,
          "games": int,
          "last_played_ms": int,
          "last_updated_ms": int,
          "act_id": str,
          "top_agent": str,
          "avg_combat_score": int,
      },
      "is_running": bool,
  }
  ```
- Implement `load_profiles()`, `save_profiles()`, `add_profile()`, `update_profile()`, `delete_profile()`, `reorder_profiles()`
- Wire JSON-line protocol handlers for all profile operations
- Add `get_profiles`, `get_profile`, `create_profile`, `update_profile`, `delete_profile` methods

**Verification**: Send JSON requests via stdin, verify profiles CRUD works and file persists.

**Files**:
```
src/backend/main.py
src/backend/protocol.py
src/backend/profile_manager.py
src/backend/data_types.py
```

---

## Step 3: Python Backend — HenrikDev API + Rank Tracking

**Goal**: Fetch rank/stats from HenrikDev API for any PUUID and return structured data.

**Tasks**:
- Implement `ValorantTracker` class with HenrikDev v3 API integration
- MMR endpoint: `GET /valorant/v3/by-puuid/mmr/{region}/{platform}/{puuid}`
- Matches endpoint: `GET /valorant/v3/by-puuid/matches/{region}/{platform}/{puuid}`
- Extract: tier, rank_name, rr, peak_rank, wins, games, top_agent, avg_combat_score
- API key from `.env` file (`HENRIKDEV_API_KEY=...`)
- Rate limiting (min 2.2s between requests)
- Error handling for 404 (no data), 429 (rate limited), network errors
- Wire to protocol: `fetch_rank(profile_name)`, `refresh_all_ranks()`

**Verification**: With a valid PUUID and API key, `fetch_rank` returns correct tier/RR/peak/agent/ACS.

**Files**:
```
src/backend/valorant_tracker.py
src/backend/henrik_client.py
```

---

## Step 4: Python Backend — Riot Client Management

**Goal**: Launch/kill Riot Client, manage VALORANT process, detect running accounts.

**Tasks**:
- Implement `RiotClient` class
- Locate `RiotClientServices.exe` via registry keys or `RiotClientInstalls.json`
- Kill all Riot processes (`taskkill /F /T`)
- Wait for processes to die (polling with timeout)
- Launch Riot Client with args (`--launch-patchline=live --launch-product=valorant`)
- Read lockfile for process detection
- Implement `RiotAccountDetect` — watch for live account via session file, decode JWT for PUUID/Riot ID
- Implement `RiotProcesses` — kill, poll, detect process states

**Verification**: `launch_client("valorant")` starts VALORANT, `detect_account()` returns PUUID and Riot ID after login.

**Files**:
```
src/backend/riot_client.py
src/backend/riot_account_detect.py
src/backend/riot_processes.py
```

---

## Step 5: Python Backend — Session File Swap

**Goal**: Save/restore Riot Client session files per profile to enable account switching.

**Tasks**:
- Implement `SessionManager` class
- Files to swap: `RiotGamesPrivateSettings.yaml`, `Sessions/`, `RiotClientSettings.yaml`, `client.config.yaml`, `client.settings.yaml`
- Save session: copy current files → profile backup dir
- Restore session: copy profile backup dir → current location
- Temp-then-rename pattern for crash safety
- Thread-safe (mutex around file operations)

**Verification**: Save session for profile A, switch to B, restore A — correct account is logged in.

**Files**:
```
src/backend/session_manager.py
```

---

## Step 6: Python Backend — League Settings Sync

**Goal**: Sync League of Legends game settings across profiles via master snapshot.

**Tasks**:
- Implement `LeagueSettingsSync` class
- Shared files: `game.cfg`, `PersistedSettings.json`, `input.ini`, `ItemSets.json`, `Champions/` dir
- Locate League install via registry or `RiotClientInstalls.json`
- Capture: snapshot settings from source profile → master backup with metadata.json
- Apply: deploy master snapshot to target profiles
- Verify after apply (SHA-256 hash check)
- Watchdog: detect external settings changes while a profile is running

**Verification**: Capture from source profile, apply to target — files match master snapshot hash.

**Files**:
```
src/backend/league_settings_sync.py
```

---

## Step 7: Python Backend — Deceive / Presence Proxy

**Goal**: Appear Offline feature via MITM proxies.

**Tasks**:
- Implement `DeceiveProxy` with two components:
  - **ConfigProxy** (HTTP): intercepts Riot Client config to redirect chat server to local port
  - **ChatProxy** (TCP/TLS): MITM between client and Riot chat server, filters presence stanzas
- Generate self-signed CA cert for TLS interception
- XMPP filter: modify presence XML to show offline
- Certificate injection via registry
- Lifecycle: start/stop with profile launch

**Verification**: With Deceive active, VALORANT client connects through local proxies and appears offline.

**Files**:
```
src/backend/deceive/deceive_proxy.py
src/backend/deceive/config_proxy.py
src/backend/deceive/chat_proxy.py
src/backend/deceive/xmpp_filter.py
src/backend/deceive/crypto_helper.py
```

---

## Step 8: React UI — App Shell + Routing

**Goal**: Main Electron window with navigation between Home, Settings, and Add Account views.

**Tasks**:
- Set up React Router for view switching (Home, Settings, Add Account)
- Implement `LeftMenu` sidebar component (Home, Settings buttons)
- Implement view transition animations (fade + slide)
- Set up Electron IPC hook: `useIPC()` custom hook for Python ↔ React communication
- Dark theme base (bg: `#0f0f12`, card: `#1a1a20`, accent: `#ff4655`)
- Font: Inter or similar

**Verification**: App boots, clicking sidebar items switches views with animation.

**Files**:
```
src/renderer/src/App.tsx
src/renderer/src/hooks/useIPC.ts
src/renderer/src/components/LeftMenu.tsx
src/renderer/src/views/HomeView.tsx
src/renderer/src/views/SettingsView.tsx
src/renderer/src/views/AddAccountView.tsx
```

---

## Step 9: React UI — Profile Cards + Grid

**Goal**: Profile card grid with drag-and-drop reordering, rank display, and glow effect.

**Tasks**:
- Implement `ProfileCard` component:
  - Rank icon (from tier)
  - In-game name (Name#Tag)
  - Current RR
  - W/L record
  - Top agent
  - Average combat score
  - Play/stop button
  - Delete (X) button with confirmation
  - Edit button (right-click context menu)
- Implement `ProfileGrid` with drag-and-drop reorder (use `@dnd-kit/core`)
- Implement card glow effect (CSS box-shadow animation on hover, matching Godot shader)
- Implement skeleton loading state (pulsing gray bars)
- Card size: 181×200 (matching current)
- Implement card cascade entrance animation (staggered fade-in + slide-up)
- Wire to Python IPC: `get_profiles`, `delete_profile`, `reorder_profiles`

**Verification**: Grid displays profiles with correct rank/stats, drag reorder persists, delete works.

**Files**:
```
src/renderer/src/components/ProfileCard.tsx
src/renderer/src/components/ProfileGrid.tsx
src/renderer/src/components/SkeletonCard.tsx
src/renderer/src/components/ContextMenu.tsx
src/renderer/src/styles/card-glow.css
```

---

## Step 10: React UI — Profile Launch/Stop

**Goal**: Start/stop profiles from the UI. Full orchestration: kill existing → save session → restore target → launch.

**Tasks**:
- Implement launch flow in Python backend:
  1. Kill all Riot processes
  2. Wait for processes to die
  3. Save current profile's session files
  4. Restore target profile's session files
  5. Launch Riot Client with correct product
  6. (Optional) Sync League settings if enabled
  7. (Optional) Start Deceive proxy if enabled
- Implement `useProfileLaunch()` hook for UI state management
- Progress feedback on card (loading spinner → running indicator)
- Handle failures gracefully (revert session on launch failure)
- Emit `valorant_data_updated` events when rank refreshes

**Verification**: Click play → VALORANT launches with correct account, rank updates on card.

**Files**:
```
src/backend/launch_orchestrator.py
src/renderer/src/hooks/useProfileLaunch.ts
```

---

## Step 11: React UI — Add Account Flow

**Goal**: Auto-detect new Riot account login and create profile.

**Tasks**:
- Implement Add Account view with status/progress indicators
- Flow: open Riot Client → poll for new account → auto-create profile
- Show progress: "Waiting for login...", "Detected: Name#Tag", "Profile created!"
- Cancel button to abort detection
- Wire to Python: `start_account_detection()`, `stop_account_detection()`
- Emit events: `account_detection_progress`, `profile_created`

**Verification**: Click "Add Account" → Riot Client opens → log in with new account → profile auto-creates in grid.

**Files**:
```
src/renderer/src/views/AddAccountView.tsx
src/renderer/src/hooks/useAccountDetection.ts
```

---

## Step 12: React UI — Settings View

**Goal**: Settings view with all toggles and configuration options.

**Tasks**:
- Implement settings cards with toggles:
  - Sync Game Settings (on/off + source profile picker)
  - Appear Offline (Deceive on/off)
  - Launch Product (VALORANT / Riot Client only)
  - Close to Tray (on/off)
  - Minimize to Tray (on/off)
  - Language selector
- Persist settings via Python: `get_config()`, `set_config()`
- Implement cascade entrance animation for settings cards

**Verification**: Toggle settings, restart app — settings persist.

**Files**:
```
src/renderer/src/views/SettingsView.tsx
src/renderer/src/components/SettingToggle.tsx
src/renderer/src/components/SettingDropdown.tsx
```

---

## Step 13: Electron — System Tray + Window Management

**Goal**: System tray integration, minimize-to-tray, close-to-tray behavior.

**Tasks**:
- Implement system tray icon with context menu (Show, Exit)
- Minimize to tray when window is closed (if enabled)
- Close to tray behavior
- Single instance lock
- Window icon (ICO format)

**Verification**: Close window → app stays in tray → right-click tray → Show restores window.

**Files**:
```
src/main/tray.ts
src/main/window.ts
```

---

## Step 14: Electron — Packaging + Distribution

**Goal**: Build distributable Windows app with embedded Python backend.

**Tasks**:
- Configure `electron-builder` for Windows (NSIS installer)
- Bundle Python backend: use PyInstaller to create standalone `.exe`
- Auto-launch option (registry key)
- App icon and metadata
- Version management

**Verification**: `npm run build` produces working installer, installs and runs without dev dependencies.

**Files**:
```
electron-builder.yml
build/build-python.spec
```

---

## Dependency Graph

```
Step 1 (Scaffold)
  └─ Step 2 (Profile Manager)
       ├─ Step 3 (HenrikDev API)
       ├─ Step 4 (Riot Client)
       │    └─ Step 5 (Session Swap)
       ├─ Step 6 (League Settings)
       └─ Step 7 (Deceive Proxy)

Step 8 (React Shell)
  └─ Step 9 (Profile Cards + Grid)
       └─ Step 10 (Launch/Stop)
            ├─ Step 11 (Add Account)
            └─ Step 12 (Settings)
                 └─ Step 13 (System Tray)
                      └─ Step 14 (Packaging)
```

**Parallel tracks**: Steps 2–7 (Python backend) and Steps 8–9 (React UI) can be developed in parallel. Steps 10–14 require both tracks to be complete.

## Current State

- [x] Step 1: Project Scaffolding
- [x] Step 2: Profile Manager
- [x] Step 3: HenrikDev API + Rank Tracking
- [x] Step 4: Riot Client Management
- [x] Step 5: Session File Swap
- [x] Step 6: League Settings Sync
- [x] Step 7: Deceive / Presence Proxy
- [ ] Step 8: React App Shell + Routing
- [ ] Step 9: Profile Cards + Grid
- [ ] Step 10: Profile Launch/Stop
- [ ] Step 11: Add Account Flow
- [ ] Step 12: Settings View
- [ ] Step 13: System Tray + Window
- [ ] Step 14: Packaging + Distribution
