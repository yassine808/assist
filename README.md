# RiotSwitcher v2.0

> Instantly switch between multiple Riot Games accounts — VALORANT, League of Legends, and more.

RiotSwitcher is a desktop application that lets you manage and switch between multiple Riot Games accounts with zero hassle. It swaps session files on disk so you never have to log out and log back in manually.

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Desktop Shell | Electron 35 (Chromium) |
| Frontend | React 19, TypeScript, Tailwind CSS |
| Backend | Python 3.9+ |
| IPC | JSON-line over stdin/stdout |
| Encryption | PBKDF2-HMAC-SHA256 + Fernet (480k iterations) |
| VALORANT API | HenrikDev API v3, valorant-api.com |
| Presence Proxy | Custom MITM (ported from Deceive) |

---

## Architecture

RiotSwitcher runs as **three cooperating processes**:

```mermaid
graph TB
    subgraph "Electron Main Process"
        EM[Main Process<br/>src/main/index.ts]
        PB[PythonBridge<br/>python-bridge.ts]
        TR[Tray<br/>tray.ts]
        WIN[BrowserWindow<br/>window.ts]
    end

    subgraph "Python Backend"
        PY[main.py<br/>Handler Dispatch]
        PM[ProfileManager]
        SM[SessionManager]
        RC[RiotClientManager]
        VT[ValorantTracker]
        LO[LaunchOrchestrator]
        AD[AccountDetector]
        LS[LeagueSettingsSync]
        DP[Deceive Proxy Stack]
        AG[AgentDatabase]
        CM[ConfigManager]
    end

    subgraph "React Renderer"
        RN[main.tsx]
        APP[App.tsx]
        HV[HomeView]
        SV[SettingsView]
        PC[ProfileCard]
        AB[AddAccountModal]
        PP[PlayerCardPicker]
        IE[ImportExportModal]
    end

    EM --> PB
    EM --> WIN
    EM --> TR
    WIN --> RN

    PB -- "JSON-line stdin/stdout" --> PY
    PY -- "async events" --> PB

    PY --> PM
    PY --> SM
    PY --> RC
    PY --> VT
    PY --> LO
    PY --> AD
    PY --> LS
    PY --> DP
    PY --> AG
    PY --> CM

    RN --> APP
    APP --> HV
    APP --> SV
    HV --> PC
    HV --> AB
    HV --> PP
    HV --> IE

    HV -- "useIPC" --> PB
    SV -- "useIPC" --> PB
```

---

## Features

### Account Management
- **Instant account switching** — swap Riot Client session files without re-login (auto-kills running processes)
- **Auto-detect new accounts** — detects when a new Riot account logs in and offers to save it
- **Profile cards** — Valorant lobby-style cards with full playercard art, rank icon, agent icon, RR, wins/losses
- **Drag-and-drop reorder** — arrange profiles however you like
- **Playercard picker** — choose from 3000+ VALORANT playercards or let the system auto-detect your equipped card

### VALORANT Integration
- **Live rank tracking** — fetches MMR, RR, peak rank, win rate from HenrikDev API
- **Agent stats** — top agent icon, ACS, per-agent performance breakdown
- **Recent match history** — last 30 competitive games with detailed stats
- **Agent visuals** — agent display icons, portraits, backgrounds, and role-colored accents

### Cross-Platform Features
- **League of Legends settings sync** — share hotkeys, video, audio, and interface settings across profiles
- **Appear Offline** — MITM proxy (ported from Deceive) that makes you invisible to friends
- **Import/Export** — encrypted backup of all profiles, transferable across PCs with a passkey

### System
- **Auto-kill on launch** — kills VALORANT + Riot Client automatically when switching profiles
- **Close/Minimize to tray** — keep RiotSwitcher running in the background
- **Auto-detect Riot Client** — finds install directory from registry, JSON, and metadata

---

## Use Cases

```mermaid
mindmap
  root((RiotSwitcher))
    Account Switching
      Switch between personal and work accounts
      Quick swap during stream breaks
      Share a PC with friends
      Test different account ranks
    VALORANT Stats
      Track rank across multiple accounts
      Compare win rates and agent stats
      Monitor peak rank progress
      Review recent match performance
    Backup & Transfer
      Export encrypted profile backup
      Transfer profiles to a new PC
      Restore after a fresh Windows install
      Share account list with a friend
    Appear Offline
      Hide from friends list while playing
      Stream without interruptions
      Avoid questions about which account
    League Sync
      Keep same hotkeys across VALORANT accounts
      Share video settings everywhere
      Avoid reconfiguring League each switch
    Multi-Game
      Switch between VALORANT and League
      Launch different Riot games per profile
```

---

## Key Flows

### Profile Switch Sequence

```mermaid
sequenceDiagram
    participant U as User
    participant UI as React UI
    participant BE as Python Backend
    participant FS as File System
    participant RC as Riot Client

    U->>UI: Click "Play" on profile
    UI->>BE: launch_profile(name)
    
    Note over BE: Step 1 — Kill existing processes
    BE->>RC: taskkill /F /T
    BE->>FS: Wait for processes to exit (8s timeout)

    Note over BE: Step 2 — Save current session
    BE->>FS: Backup RiotGamesPrivateSettings.yaml
    BE->>FS: Backup Sessions/ directory
    BE->>FS: Backup client.config.yaml

    Note over BE: Step 3 — Restore target session
    BE->>FS: Copy target profile files → live Riot dir
    BE->>FS: Atomic rename (temp → final)

    Note over BE: Step 4 — League Sync (optional)
    BE->>FS: Deploy master snapshot to League/Config
    BE->>FS: Verify SHA-256 hashes
    BE->>FS: Set read-only flags (optional)

    Note over BE: Step 5 — Appear Offline (optional)
    BE->>BE: Start Deceive proxy stack
    BE->>BE: Generate --client-config-url arg

    Note over BE: Step 6 — Launch Riot Client
    BE->>RC: Spawn RiotClientServices.exe
    BE->>FS: Save LastRunningProfile
    BE-->>UI: profile_switch_progress events
    UI-->>U: Launching → Launched state
```

### Add Account Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as AddAccountModal
    participant BE as Python Backend
    participant RC as Riot Client
    participant FS as File System

    U->>UI: Click "Add Account"
    UI->>BE: check_current_account()
    BE->>FS: Read RiotGamesPrivateSettings.yaml
    BE->>BE: Decode JWT id_token
    BE-->>UI: {found, display, is_new}

    alt New account already logged in
        UI-->>U: Show suggestion: "Add [name]?"
        U->>UI: Click "Add Account"
        UI->>BE: create_profile(account_data)
        BE->>FS: Write to profiles_data.json
        BE-->>UI: profile_created event
    else No account / already added
        UI->>BE: start_account_detection()
        BE->>RC: Kill all Riot processes
        BE->>RC: Launch fresh Riot Client
        BE-->>UI: "Waiting for login…"

        U->>RC: Logs in with new account
        BE->>FS: Polls live settings every 1.5s
        BE->>BE: Decode JWT, check if PUUID is new

        alt Account already saved
            BE->>RC: Kill + re-launch fresh
            BE-->>UI: "Already added. Launching again…"
            Note over BE: Loops until new account
        else New account detected
            BE-->>UI: confirm_save event
            UI-->>U: Show: "Detected: name#tag"
            U->>UI: Click "Save Profile"
            UI->>BE: confirm_account_save(accepted=true)
            BE->>FS: Create profile in profiles_data.json
            BE-->>UI: profile_created event
            UI-->>U: "Profile Created!" ✓
        end
    end
```

### Import/Export Flow

```mermaid
sequenceDiagram
    participant U as User
    participant UI as ImportExportModal
    participant BE as Python Backend
    participant FS as File System

    rect rgb(30, 40, 60)
    Note over U,FS: Export Flow
    U->>UI: Enter passkey + click Export
    UI->>BE: export_profiles(passkey)
    BE->>FS: Load profiles_data.json
    BE->>BE: JSON serialize profiles
    BE->>BE: PBKDF2 derive key (480k iterations)
    BE->>BE: Fernet encrypt with derived key
    BE-->>UI: Encrypted bytes
    UI->>UI: Download as .rsprofile file
    UI-->>U: "Exported!" ✓
    end

    rect rgb(30, 40, 60)
    Note over U,FS: Import Flow
    U->>UI: Select .rsprofile file + enter passkey
    UI->>BE: import_profiles(passkey, data, merge=true)
    BE->>BE: PBKDF2 derive key (480k iterations)
    BE->>BE: Fernet decrypt with derived key
    BE->>BE: JSON parse profiles
    BE->>FS: Load existing profiles
    BE->>BE: Deduplicate by PUUID + name
    BE->>FS: Write merged profiles
    BE-->>UI: {imported, skipped, total}
    UI-->>U: "Imported X of Y profiles" ✓
    end
```

### Appear Offline Proxy Stack

```mermaid
graph LR
    subgraph "Riot Client"
        RC[Client XMPP]
    end

    subgraph "Deceive Proxy (localhost)"
        CP[ConfigProxy<br/>HTTP :auto]
        CMP[ChatProxy<br/>TLS :auto]
        XF[XMPP Filter]
    end

    subgraph "Riot Servers"
        RS[Real Config<br/>clientconfig.rpg.riotgames.com]
        CS[Real Chat<br/>chat.na2w.val.ncdns.net]
    end

    RC -- "HTTPS config request" --> CP
    CP -- "Fetch real config" --> RS
    CP -- "Patch: redirect chat to localhost" --> CP
    CP -- "Return patched config" --> RC

    RC -- "TLS XMPP connect" --> CMP
    CMP -- "TLS bridge" --> CS
    CMP --> XF
    XF -- "Replace presence with unavailable" --> CMP
    CMP -- "Filtered XMPP" --> RC
```

---

## Component Architecture

```mermaid
graph TB
    subgraph "App Shell"
        TB[TitleBar<br/>Gradient line + Orb logo]
        SB[Sidebar<br/>Home / Settings nav]
    end

    subgraph "Home View"
        HG[Header Bar]
        PG[ProfileGrid]
        PC1[ProfileCard 1]
        PC2[ProfileCard 2]
        PC3[ProfileCard N]
    end

    subgraph "Modals"
        AAM[AddAccountModal]
        IEM[ImportExportModal]
        PCP[PlayerCardPicker]
        CFD[ConfirmDelete]
    end

    subgraph "Settings View"
        RC[Card: Riot Client]
        GS[Card: Game Sync]
        AO[Card: Appear Offline]
        SY[Card: System]
    end

    TB --> SB
    SB --> HG
    SB --> PG
    PG --> PC1
    PG --> PC2
    PG --> PC3
    HG --> AAM
    HG --> IEM
    PC1 --> PCP
    PC1 --> CFD
    SB --> RC
    SB --> GS
    SB --> AO
    SB --> SY
```

---

## IPC Protocol

Communication between the Electron main process and Python backend uses a **JSON-line protocol** over stdin/stdout:

```mermaid
sequenceDiagram
    participant R as Renderer
    participant E as Electron Main
    participant P as Python Backend

    R->>E: electronAPI.call("get_profiles", {})
    E->>P: {"id": "req-1", "method": "get_profiles", "params": {}}
    P->>P: profiles.load()
    P-->>E: {"id": "req-1", "result": [...]}
    E-->>R: Profile[]

    Note over P: Async event
    P-->>E: {"event": "valorant_data_updated", "params": {"profile_name": "x"}}
    E-->>R: onEvent("valorant_data_updated", {...})
```

### All IPC Handlers

| # | Handler | Description |
|---|---------|-------------|
| 1 | `ping` | Health check |
| 2 | `get_profiles` | List all profiles |
| 3 | `create_profile` | Create a new profile |
| 4 | `delete_profile` | Delete a profile |
| 5 | `update_profile` | Update profile data |
| 6 | `rename_profile` | Rename a profile |
| 7 | `reorder_profiles` | Reorder profile list |
| 8 | `get_valorant` | Get VALORANT stats for a profile |
| 9 | `refresh_valorant` | Trigger rank/stat refresh |
| 10 | `refresh_valorant_all` | Refresh all profiles |
| 11 | `has_api_key` | Check if HenrikDev API key exists |
| 12 | `get_config` | Get all config values |
| 13 | `set_config` | Set a config value |
| 14 | `set_config_many` | Set multiple config values |
| 15 | `set_riot_client_location` | Set Riot Client install path |
| 16 | `detect_riot_client_location` | Auto-detect Riot Client path |
| 17 | `get_riot_client_status` | Get Riot Client status |
| 18 | `kill_riot_processes` | Kill all Riot processes |
| 19 | `stop_riot_client` | Kill and wait for Riot Client |
| 20 | `launch_riot_client` | Spawn Riot Client |
| 21 | `launch_profile` | Full profile switch sequence |
| 22 | `stop_profile` | Stop profile switch |
| 23 | `read_live_account` | Read current logged-in account |
| 24 | `check_current_account` | Check if current account is new |
| 25 | `detect_live_account_new` | Check if account is new vs saved |
| 26 | `start_account_detection` | Start background account detection |
| 27 | `stop_account_detection` | Stop account detection |
| 28 | `account_detection_state` | Check if detection is running |
| 29 | `confirm_account_save` | Accept/decline saving detected account |
| 30 | `save_session` | Backup session files for a profile |
| 31 | `restore_session` | Restore session files from backup |
| 32 | `has_session` | Check if profile has saved session |
| 33 | `league_find_dir` | Detect League install directory |
| 34 | `league_capture` | Capture League settings snapshot |
| 35 | `league_apply` | Deploy settings to League Config |
| 36 | `league_refresh` | Validate master snapshot |
| 37 | `league_dir_differs` | Compare live vs master settings |
| 38 | `league_cleanup_readonly` | Remove read-only flags |
| 39 | `league_resolve_source` | Get source profile info |
| 40 | `league_get_metadata` | Get snapshot metadata |
| 41 | `presence_start` | Start Appear Offline proxy |
| 42 | `presence_stop` | Stop Appear Offline proxy |
| 43 | `presence_state` | Get proxy state |
| 44 | `presence_get_ports` | Get proxy port info |
| 45 | `presence_get_launch_args` | Get Riot launch args with proxy |
| 46 | `export_profiles` | Encrypt and export profiles |
| 47 | `import_profiles` | Decrypt and import profiles |
| 48 | `get_playercards` | Fetch all playercards |
| 49 | `set_playercard` | Set profile playercard |

---

## Data Flow

```mermaid
graph TB
    subgraph "External APIs"
        HK[HenrikDev API<br/>Rank + Match Data]
        VA[valorant-api.com<br/>Playercards + Agents + Ranks]
    end

    subgraph "Local Files"
        PD[profiles_data.json<br/>Profile Data]
        CD[configs.json<br/>App Settings]
        AE[agents.enc<br/>Encrypted Agent Cache]
        RF[RiotGamesPrivateSettings.yaml<br/>Live Session]
        LF[League Config dir<br/>Hotkeys + Video + Audio]
    end

    subgraph "Python Backend"
        VT[ValorantTracker]
        AD[AgentDatabase]
        SM[SessionManager]
        PM[ProfileManager]
        LS[LeagueSettingsSync]
        RC[RiotClientManager]
    end

    subgraph "React UI"
        PC[ProfileCard]
        SV[SettingsView]
    end

    HK --> VT
    VA --> VT
    VA --> AD
    VT --> PD
    AD --> AE
    PD --> PM
    PM --> PC
    SM --> RF
    LS --> LF
    RC --> RF
    CD --> SV
```

---

## Configuration

| Config Key | Default | Description |
|-----------|---------|-------------|
| `RiotClientLocation` | `""` | Riot Client install directory |
| `LaunchProduct` | `"valorant"` | `"valorant"` or `"riot"` |
| `SyncGameSettings` | `false` | Enable League settings sync |
| `SharedSettingsSourceProfile` | `""` | Which profile's League settings are master |
| `AppearOffline` | `false` | Enable Deceive presence proxy |
| `EnforceReadOnlySettings` | `true` | Set read-only on deployed League files |
| `CloseToTray` | `true` | Hide to tray on window close |
| `MinimizeToTray` | `false` | Hide to tray on minimize |
| `Language` | `"en"` | UI language |

---

## Setup

### Development

```bash
# Install dependencies
npm install

# Run in dev mode (Electron + React hot reload + Python backend)
npm run dev
```

### Build

```bash
npm run build
```

### API Key

Create a `.env` file in the project root:

```
HENRIKDEV_API_KEY=your_key_here
```

Get a free key at [https://henrikdev.xyz](https://henrikdev.xyz).

---

## How Session Swapping Works

RiotSwitcher doesn't use any Riot APIs or inject code into the game. It swaps **session files** on disk:

```mermaid
graph LR
    subgraph "Profile A Session"
        A1[A.yaml]
        A2[A Sessions/]
        A3[A client.config]
    end

    subgraph "Live Riot Client Dir"
        L1[RiotGamesPrivateSettings.yaml]
        L2[Sessions/]
        L3[client.config.yaml]
    end

    subgraph "Profile B Session"
        B1[B.yaml]
        B2[B Sessions/]
        B3[B client.config]
    end

    A1 -- "restore" --> L1
    A2 -- "restore" --> L2
    A3 -- "restore" --> L3

    L1 -- "backup" --> B1
    L2 -- "backup" --> B2
    L3 -- "backup" --> B3
```

When you click **Play**, RiotSwitcher:
1. Auto-kills any running Riot Client / VALORANT processes
2. Backs up the current live session files into the current profile's directory
3. Copies the target profile's saved session files over the live files
4. Relaunches the Riot Client — it starts with the target account already logged in

All file operations are **atomic** (write to temp file, then rename) to prevent corruption.

---

## License

MIT
