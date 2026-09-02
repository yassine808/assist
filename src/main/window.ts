import { BrowserWindow } from "electron";
import { join } from "path";
import { PythonBridge } from "./python-bridge";

interface WindowCallbacks {
  onCloseToTray: (type: "close" | "minimize") => void;
}

export interface AppWindow {
  win: BrowserWindow;
  requestClose: () => void;
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
