import { app, BrowserWindow, ipcMain } from "electron";
import { PythonBridge } from "./python-bridge";
import { appIconPath, createAppTray } from "./tray";
import { createAppWindow, AppWindow } from "./window";

let python: PythonBridge | null = null;
let appWindow: AppWindow | null = null;

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

    setupIpc();

    appWindow = await createAppWindow(python, {
      onCloseToTray: () => {
        /* window stays alive; user opens from tray */
      },
    });

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
  ipcMain.handle("window:minimize", () => appWindow?.win.minimize());
  ipcMain.handle("window:close", () => appWindow?.win.close());
  ipcMain.handle("window:toggleMaximize", () => {
    const win = appWindow?.win;
    if (!win) return;
    win.isMaximized() ? win.unmaximize() : win.maximize();
  });

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
