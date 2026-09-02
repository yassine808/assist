import { app, BrowserWindow, ipcMain } from "electron";
import { join } from "path";
import { PythonBridge } from "./python-bridge";

let mainWindow: BrowserWindow | null = null;
let python: PythonBridge | null = null;

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1100,
    height: 750,
    minWidth: 900,
    minHeight: 600,
    frame: false,
    backgroundColor: "#0f0f12",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    mainWindow.loadFile(join(__dirname, "../renderer/index.html"));
  }

  mainWindow.once("ready-to-show", () => {
    mainWindow?.show();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function setupIpc(): void {
  ipcMain.handle("window:minimize", () => mainWindow?.minimize());
  ipcMain.handle("window:close", () => mainWindow?.close());
  ipcMain.handle("window:toggleMaximize", () => {
    if (!mainWindow) return;
    mainWindow.isMaximized() ? mainWindow.unmaximize() : mainWindow.maximize();
  });

  // Proxy all Python backend calls
  ipcMain.handle("python:call", async (_event, method: string, params: Record<string, unknown> = {}) => {
    if (!python) throw new Error("Python backend not running");
    return python.call(method, params);
  });

  // Forward Python events to renderer
  python?.onEvent((event: string, params: unknown) => {
    mainWindow?.webContents.send("python:event", { event, params });
  });
}

app.whenReady().then(() => {
  python = new PythonBridge();
  python.start();

  setupIpc();
  createWindow();

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on("window-all-closed", () => {
  python?.stop();
  if (process.platform !== "darwin") app.quit();
});

app.on("before-quit", () => {
  python?.stop();
});
