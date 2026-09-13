import { Tray, Menu, nativeImage } from "electron";
import { join } from "node:path";

interface TrayCallbacks {
  onShow: () => void;
  onQuit: () => void;
}

export function createAppTray(iconPath: string, callbacks: TrayCallbacks): Tray {
  const icon = nativeImage.createFromPath(iconPath);
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
