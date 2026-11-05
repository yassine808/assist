import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent } from "electron";
import log from "electron-log";
import { PythonBridge } from "./python-bridge";
import { appIconPath, createAppTray } from "./tray";
import { createAppWindow, AppWindow } from "./window";
import { initAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, setUpdateWindow } from "./updater";
import { registerCardScheme, handleCardProtocol, listAnimatedCards } from "./playercards";

// Bound the on-disk log. electron-log rotates the current file to `<name>.old.log`
// once it passes this size, so a long-running install cannot grow it forever.
log.transports.file.maxSize = 5 * 1024 * 1024;

let python: PythonBridge | null = null;
let appWindow: AppWindow | null = null;

registerCardScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  setup();
}

function setup(): void {
  app.on("second-instance", () => {
    if (appWindow) {
      appWindow.win.show();
      appWindow.win.focus();
    }
  });

  app.whenReady().then(async () => {
    python = new PythonBridge();
    python.start();

    handleCardProtocol();
    setupIpc();

    appWindow = await createAppWindow(python, {
      onCloseToTray: () => {
        /* window stays alive; user opens from tray */
      },
    });

    setUpdateWindow(appWindow.win);
    initAutoUpdater();

    createAppTray(appIconPath(), {
      onShow: () => {
        if (appWindow) {
          appWindow.win.show();
          appWindow.win.focus();
        }
      },
      onQuit: () => {
        app.quit();
      },
    });

    app.on("activate", () => {
      if (BrowserWindow.getAllWindows().length === 0) {
        createAppWindow(python!, { onCloseToTray: () => undefined }).then(
          (w) => (appWindow = w)
        );
      }
    });
  });

  app.on("window-all-closed", () => {
    python?.stop();
    if (process.platform !== "darwin") app.quit();
  });

  app.on("before-quit", () => {
    python?.stop();
  });
}

function setupIpc(): void {
  // Window controls must act on whichever window sent them — the settings and
  // agent-map windows share this title bar but are not `appWindow`.
  const senderWindow = (event: IpcMainInvokeEvent) =>
    BrowserWindow.fromWebContents(event.sender) ?? appWindow?.win ?? null;

  ipcMain.handle("window:minimize", (event) => senderWindow(event)?.minimize());
  ipcMain.handle("window:close", (event) => senderWindow(event)?.close());
  ipcMain.handle("window:toggleMaximize", (event) => {
    const win = senderWindow(event);
    if (!win) return;
    if (win.isMaximized()) { win.unmaximize(); } else { win.maximize(); }
  });

  ipcMain.handle("app:version", () => app.getVersion());
  ipcMain.handle("update:check", () => checkForUpdates());
  ipcMain.handle("update:download", () => downloadUpdate());
  ipcMain.handle("update:install", () => quitAndInstall());

  // Animated player cards live on disk, next to the app.
  ipcMain.handle("cards:animated", () => listAnimatedCards());

  ipcMain.handle(
    "python:call",
    async (_event, method: string, params: Record<string, unknown> = {}) => {
      if (!python) throw new Error("Python backend not running");
      return python.call(method, params);
    }
  );

  python?.onEvent((event: string, params: unknown) => {
    BrowserWindow.getAllWindows().forEach((win) =>
      win.webContents.send("python:event", { event, params })
    );
  });
}
