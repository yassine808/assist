import { autoUpdater, UpdateInfo } from "electron-updater";
import { BrowserWindow } from "electron";
import log from "electron-log";

autoUpdater.logger = log;
autoUpdater.autoDownload = false;
autoUpdater.autoInstallOnAppQuit = true;

let updateWindow: BrowserWindow | null = null;

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

  autoUpdater.on("update-downloaded", () => {
    sendToRenderer("update:status", { state: "downloaded" });
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
  autoUpdater.quitAndInstall(false, true);
}
