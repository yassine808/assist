import { BrowserWindow } from "electron";
import { join } from "node:path";
import log from "electron-log";
import { PythonBridge } from "./python-bridge";

interface WindowCallbacks {
  onCloseToTray: (type: "close" | "minimize") => void;
}

export interface AppWindow {
  win: BrowserWindow;
  requestClose: () => void;
  /** Let an app-level quit through the close-to-tray interceptor. */
  permitClose: () => void;
}

// The lobby card stack is fixed-size in CSS: title bar 40 + page top 16 +
// toolbar 32 + divider 13 (12 padding + 1 border) + gap 16 + slot top 4 +
// card 552.24 (472 × --lobby-k 1.17) + button margin 16 + button 56 +
// bottom padding 40 ≈ 785. That is the full height of one row of cards, so a
// window at the minimum shows one row without scrolling and never crops START;
// a second row is what brings the scrollbar back.
const MIN_WINDOW_HEIGHT = 788;

// Four cards at the default 1.17 scale need 4 × 217.62 + 3 × 32 + 72 ≈ 1038px
// of content. The Windows resize border adds ~16px, so this minimum keeps four
// profiles on one row instead of wrapping the fourth to a second row. The
// width above this floor is free: widening only adds empty space/reflows.
const MIN_WINDOW_WIDTH = 1060;

// A stalled page load (slow GPU init, blocked renderer) can keep the window
// hidden forever, because neither `ready-to-show` nor the post-load show runs.
// The app would then look like it never launched while still holding the
// single-instance lock. Force it visible after this long.
const SHOW_FALLBACK_MS = 5000;

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
    minWidth: MIN_WINDOW_WIDTH,
    minHeight: MIN_WINDOW_HEIGHT,
    icon: join(__dirname, "../../build/icon.png"),
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
  const reveal = (): void => {
    if (!win.isDestroyed() && !win.isVisible()) win.show();
  };
  const showFallback = setTimeout(reveal, SHOW_FALLBACK_MS);
  showFallback.unref?.();
  win.once("ready-to-show", () => {
    clearTimeout(showFallback);
    reveal();
  });

  // A rejected load must not abort the rest of start-up: the window is already
  // created, so show it and let the renderer report the failure in its own UI.
  try {
    if (process.env.ELECTRON_RENDERER_URL) {
      await win.loadURL(process.env.ELECTRON_RENDERER_URL);
    } else {
      await win.loadFile(join(__dirname, "../renderer/index.html"));
    }
  } catch (err) {
    log.error("Renderer failed to load:", err);
  }

  clearTimeout(showFallback);
  reveal();

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

  // Tray "Exit" / app.quit() also fires the window's close event. Without this
  // the close-to-tray handler would preventDefault() and swallow the quit, so
  // the app stayed alive with no window and no way back.
  const permitClose = () => {
    allowClose = true;
  };

  return { win, requestClose, permitClose };
}
