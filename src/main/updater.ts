import { autoUpdater, UpdateInfo } from "electron-updater";
import { BrowserWindow, dialog } from "electron";
import log from "electron-log";

autoUpdater.logger = log;
autoUpdater.autoDownload = true;
autoUpdater.autoInstallOnAppQuit = true;

let updateWindow: BrowserWindow | null = null;
let installing = false;

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

export function initAutoUpdater(): void {
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

  // Check on startup (after a short delay so the window loads first)
  setTimeout(() => {
    autoUpdater.checkForUpdates().catch(() => {});
  }, 5000);
}

export function checkForUpdates(): void {
  autoUpdater.checkForUpdates().catch(() => {});
}

export function downloadUpdate(): void {
  autoUpdater.downloadUpdate().catch(() => {});
}

export function quitAndInstall(): void {
  installOnce();
}
