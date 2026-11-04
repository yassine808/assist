import { app, BrowserWindow, dialog } from "electron";
import { autoUpdater, UpdateInfo } from "electron-updater";
import log from "electron-log";

// Re-check every four hours so a long-running session still picks up a release
// published after the app was opened. Startup does the first check.
const UPDATE_CHECK_INTERVAL_MS = 4 * 60 * 60 * 1000;
const STARTUP_CHECK_DELAY_MS = 5000;

autoUpdater.logger = log;
// Download and install without asking: the dialog below only offers "restart
// now" or "apply on next quit", never "skip this version".
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;
autoUpdater.autoRunAppAfterInstall = true;
autoUpdater.allowDowngrade = false;

let updateWindow: BrowserWindow | null = null;
let installing = false;
let checkTimer: NodeJS.Timeout | null = null;

/** Quit-and-install may only be initiated once per process lifetime. */
function installOnce(): void {
  if (installing) {
    return;
  }
  installing = true;
  autoUpdater.quitAndInstall(false, true);
}

export function setUpdateWindow(win: BrowserWindow): void {
  updateWindow = win;
}

function sendToRenderer(channel: string, ...args: unknown[]): void {
  if (updateWindow && !updateWindow.isDestroyed()) {
    updateWindow.webContents.send(channel, ...args);
  }
}

function runCheck(): void {
  autoUpdater.checkForUpdates().catch((err) => {
    // Offline, rate-limited, or no release published yet — all non-fatal.
    log.warn("Update check failed:", err?.message ?? err);
  });
}

export function initAutoUpdater(): void {
  if (!app.isPackaged) {
    // electron-updater needs the generated app-update.yml and an installed
    // build; in dev it would only log errors on every check.
    log.info("Auto-updater disabled outside a packaged build");
    return;
  }

  autoUpdater.on("checking-for-update", () => {
    sendToRenderer("update:status", { state: "checking" });
  });

  autoUpdater.on("update-available", (info: UpdateInfo) => {
    sendToRenderer("update:status", {
      state: "available",
      version: info.version,
      releaseNotes: info.releaseNotes ?? "",
    });
  });

  autoUpdater.on("update-not-available", () => {
    sendToRenderer("update:status", { state: "up-to-date" });
  });

  autoUpdater.on("download-progress", (progress) => {
    sendToRenderer("update:status", {
      state: "downloading",
      percent: Math.round(progress.percent),
      bytesPerSecond: progress.bytesPerSecond,
      transferred: progress.transferred,
      total: progress.total,
    });
  });

  autoUpdater.on("update-downloaded", (info: UpdateInfo) => {
    sendToRenderer("update:status", { state: "downloaded", version: info.version });
    // Parent the dialog to the live window, otherwise it can open behind the
    // app (or as an orphan taskbar entry) on Windows.
    const parent = updateWindow && !updateWindow.isDestroyed() ? updateWindow : undefined;
    dialog
      .showMessageBox(parent!, {
        type: "info",
        title: "Update Ready",
        message: `Riot Switcher v${info.version} has been downloaded.`,
        // autoInstallOnAppQuit is enabled, so "Later" only defers to the next
        // quit. Say so rather than implying the update is being declined.
        detail: "Restart now to apply the update, or keep using the app — it will be installed the next time Riot Switcher closes.",
        buttons: ["Restart Now", "Later"],
        defaultId: 0,
        cancelId: 1,
      })
      .then(({ response }) => {
        if (response === 0) {
          installOnce();
        }
      });
  });

  autoUpdater.on("error", (err) => {
    log.error("Auto-updater error:", err);
    sendToRenderer("update:status", { state: "error", message: err.message });
  });

  // First check shortly after the window is up, then on a fixed interval.
  setTimeout(runCheck, STARTUP_CHECK_DELAY_MS);
  checkTimer = setInterval(runCheck, UPDATE_CHECK_INTERVAL_MS);
  checkTimer.unref?.();
}

export function checkForUpdates(): void {
  if (!app.isPackaged) {
    sendToRenderer("update:status", { state: "up-to-date" });
    return;
  }
  runCheck();
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch(() => {});
}

export function quitAndInstall(): void {
  installOnce();
}
