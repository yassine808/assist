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

// The lobby card stack is fixed-size in CSS: title bar 40 + page top 16 +
// toolbar 32 + divider 13 (12 padding + 1 border) + gap 16 + slot top 4 +
// card 552.24 (472 × --lobby-k 1.17) + button margin 16 + button 56 +
// bottom padding 40 ≈ 785. That is the full height of one row of cards, so a
// window at the minimum shows one row without scrolling and never crops START;
// a second row is what brings the scrollbar back.
const MIN_WINDOW_HEIGHT = 788;

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
    height: 790,
    minWidth: 900,
    minHeight: MIN_WINDOW_HEIGHT,
    frame: false,
    backgroundColor: "#0f0f12",
    show: false,
    webPreferences: {
      preload: join(__dirname, "../preload/preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });

  // Attach before loading: with a warm renderer the event can fire before an
  // `await loadURL` resolves, and a late listener would keep the window hidden.
  win.once("ready-to-show", () => win.show());

  if (process.env.ELECTRON_RENDERER_URL) {
    await win.loadURL(process.env.ELECTRON_RENDERER_URL);
  } else {
    await win.loadFile(join(__dirname, "../renderer/index.html"));
  }

  if (!win.isVisible()) win.show();

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
