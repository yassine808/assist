import { app, BrowserWindow, ipcMain, IpcMainInvokeEvent, shell } from "electron";
import log from "electron-log";
import { PythonBridge } from "./python-bridge";
import { appIconPath, createAppTray } from "./tray";
import { createAppWindow, AppWindow } from "./window";
import { initAutoUpdater, checkForUpdates, downloadUpdate, quitAndInstall, setUpdateWindow } from "./updater";
import { registerCardScheme, handleCardProtocol, listAnimatedCards } from "./playercards";
import { createProfileShortcut, launchProfileFromArgv } from "./shortcuts";

// Bound the on-disk log. electron-log rotates the current file to `<name>.old.log`
// once it passes this size, so a long-running install cannot grow it forever.
log.transports.file.maxSize = 5 * 1024 * 1024;

let python: PythonBridge | null = null;
let appWindow: AppWindow | null = null;
// Set from `--profile`, which a desktop shortcut passes on start-up. Held until
// the backend reports it is ready, then sent once.
let pendingProfileLaunch = launchProfileFromArgv(process.argv);

// Without a handler a rejection (e.g. a failed window load) is swallowed and
// the app sits invisible with no trace of why. Log it instead.
process.on("unhandledRejection", (reason) => {
  log.error("Unhandled rejection:", reason);
});

registerCardScheme();

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  setup();
}

function launchProfile(name: string): void {
  const profile = name.trim();
  if (!profile || !python) return;
  void python.call("launch_profile", { name: profile }).catch((err) => {
    console.error(`[launcher] could not launch '${profile}':`, err);
  });
}

function setup(): void {
  app.on("second-instance", (_event, argv) => {
    if (appWindow) {
      appWindow.win.show();
      appWindow.win.focus();
    } else {
      // Start-up did not finish (no appWindow yet). Still surface whatever
      // window exists so a second click is never a silent no-op.
      const existing = BrowserWindow.getAllWindows().find((win) => !win.isDestroyed());
      existing?.show();
      existing?.focus();
    }
    // A shortcut clicked while the app is already open reuses this instance.
    const profile = launchProfileFromArgv(argv);
    if (profile) launchProfile(profile);
  });

  app.whenReady().then(async () => {
    python = new PythonBridge();
    // Register before start(): backend_ready can arrive on the first stdout
    // chunk, and the pending profile must not be dropped.
    python.onEvent((event) => {
      if (event !== "backend_ready" || !pendingProfileLaunch) return;
      const profile = pendingProfileLaunch;
      pendingProfileLaunch = "";
      launchProfile(profile);
    });
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
        // The window's close handler intercepts "close to tray"; clear that
        // first or app.quit() is cancelled and the process stays alive with no
        // window (the "exiting null" bug).
        appWindow?.permitClose();
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
    // Covers every quit path (tray, OS shutdown, installer) not just the tray
    // item, so a close-to-tray window can never block the exit.
    appWindow?.permitClose();
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

  ipcMain.handle("profile:createShortcut", (_event, name: unknown) =>
    createProfileShortcut(String(name ?? ""))
  );

  // "Support the project" opens the project's sponsorship page in the user's
  // real browser. Only https is accepted so the renderer cannot use this as a
  // generic protocol launcher.
  ipcMain.handle("shell:openExternal", async (_event, url: unknown) => {
    const target = String(url ?? "");
    if (!/^https:\/\//i.test(target)) {
      throw new Error("Only https links can be opened");
    }
    await shell.openExternal(target);
  });

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
