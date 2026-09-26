import { BrowserWindow } from "electron";
import { join } from "node:path";
import { PythonBridge } from "./python-bridge";

interface WindowCallbacks {
  onCloseToTray: (type: "close" | "minimize") => void;
}

export interface AppWindow {
  win: BrowserWindow;
  requestClose: () => void;
}

let settingsWindow: BrowserWindow | null = null;
let agentMapWindow: BrowserWindow | null = null;

/**
 * Secondary views each get their own BrowserWindow, keyed by `view` query param.
 * `singleton` keeps one window per view and refocuses it when already open.
 */
function openViewWindow(
  view: "settings" | "agent-maps",
  options: {
    width: number;
    height: number;
    minWidth: number;
    minHeight: number;
  },
  current: () => BrowserWindow | null,
  setCurrent: (win: BrowserWindow | null) => void
): void {
  const existing = current();
  if (existing && !existing.isDestroyed()) {
    existing.focus();
    return;
  }

  const win = new BrowserWindow({
    width: options.width,
    height: options.height,
    minWidth: options.minWidth,
    minHeight: options.minHeight,
    frame: false,
    backgroundColor: "#0f0f12",
    show: false,
    parent: undefined,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  if (process.env.ELECTRON_RENDERER_URL) {
    win.loadURL(`${process.env.ELECTRON_RENDERER_URL}?view=${view}`);
  } else {
    win.loadFile(join(__dirname, "../renderer/index.html"), { query: { view } });
  }

  win.once("ready-to-show", () => win.show());
  win.on("closed", () => setCurrent(null));
}

export function openSettingsWindow(_python: PythonBridge): void {
  openViewWindow(
    "settings",
    { width: 700, height: 650, minWidth: 550, minHeight: 500 },
    () => settingsWindow,
    (win) => (settingsWindow = win)
  );
}

export function openAgentMapWindow(): void {
  openViewWindow(
    "agent-maps",
    { width: 1000, height: 720, minWidth: 800, minHeight: 560 },
    () => agentMapWindow,
    (win) => (agentMapWindow = win)
  );
}

async function readTrayConfig(
  python: PythonBridge
): Promise<{ closeToTray: boolean; minimizeToTray: boolean }> {
  try {
    const cfg = (await python.call("get_config")) as Record<string, unknown> | null;
    return {
      closeToTray: Boolean(cfg?.CloseToTray ?? true),
      minimizeToTray: Boolean(cfg?.MinimizeToTray ?? false),
    };
  } catch {
    return { closeToTray: true, minimizeToTray: false };
  }
}

export async function createAppWindow(
  python: PythonBridge,
  callbacks: WindowCallbacks
): Promise<AppWindow> {
  const win = new BrowserWindow({
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
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  win.once("ready-to-show", () => win.show());

  const { closeToTray, minimizeToTray } = await readTrayConfig(python);

  // Intercept window close: hide to tray if enabled.
  let allowClose = false;
  win.on("close", (event) => {
    if (allowClose) return;
    if (closeToTray) {
      event.preventDefault();
      callbacks.onCloseToTray("close");
    }
  });

  // Intercept minimize: hide to tray if enabled.
  win.on("minimize", () => {
    if (minimizeToTray) {
      win.hide();
      callbacks.onCloseToTray("minimize");
    }
  });

  win.on("closed", () => {
    allowClose = true;
  });

  const requestClose = () => {
    allowClose = true;
    win.close();
  };

  return { win, requestClose };
}
