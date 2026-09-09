import { Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";

interface TrayCallbacks {
  onShow: () => void;
  onQuit: () => void;
}

export function createAppTray(iconPath: string, callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(iconPath);
  if (!icon.isEmpty()) {
    const resized = icon.resize({ width: 16, height: 16 });
    if (!resized.isEmpty()) {
      // resized image is kept in scope
    }
  }

  const tray = new Tray(icon);

  const menu = Menu.buildFromTemplate([
    { label: "RiotSwitcher", enabled: false },
    { type: "separator" },
    { label: "Show", click: () => callbacks.onShow() },
    { label: "Exit", click: () => callbacks.onQuit() },
  ]);
  tray.setToolTip("RiotSwitcher");
  tray.setContextMenu(menu);

  tray.on("click", () => callbacks.onShow());

  return tray;
}

export function appIconPath(): string {
  return join(__dirname, "../../build/icon.png");
}
