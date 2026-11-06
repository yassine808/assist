import { app, shell } from "electron";
import { join } from "node:path";

/**
 * A desktop shortcut is a Windows `.lnk` that starts RiotSwitcher with a
 * profile name, so double-clicking it switches to that account and launches
 * the client without opening the lobby first.
 *
 * The launcher is the Electron executable itself:
 *  - packaged: `RiotSwitcher.exe --profile "Name"`;
 *  - dev: `electron.exe "<project root>" --profile "Name"`.
 */
const PROFILE_FLAG = "--profile";

/** Characters Windows rejects in a file name, plus control characters. */
const INVALID_FILE_CHARS = String.raw`<>:"/\|?*`;

export function sanitizeShortcutName(name: string): string {
  const withoutInvalid = Array.from(name)
    .map((char) =>
      char.codePointAt(0)! < 32 || INVALID_FILE_CHARS.includes(char) ? "_" : char
    )
    .join("");
  // Windows drops trailing dots and spaces, which would silently rename the
  // file and leave the "already exists" check looking at the wrong path.
  // Trailing character trimming is done without a regex so the check stays
  // linear even for a pathologically long name.
  let end = withoutInvalid.length;
  while (end > 0 && (withoutInvalid[end - 1] === "." || withoutInvalid[end - 1] === " ")) {
    end -= 1;
  }
  const cleaned = withoutInvalid.slice(0, end).slice(0, 80).trim();
  return cleaned || "Profile";
}

export function profileShortcutPath(name: string, desktopDir = app.getPath("desktop")): string {
  return join(desktopDir, `RiotSwitcher - ${sanitizeShortcutName(name)}.lnk`);
}

/** Arguments that make the Electron executable reopen the app on a profile. */
export function profileLaunchArgs(name: string): string[] {
  if (app.isPackaged) return [PROFILE_FLAG, name];
  return [app.getAppPath(), PROFILE_FLAG, name];
}

/** Quote one argv element for the single `.lnk` arguments string. */
function quoteArg(arg: string): string {
  if (!/[\s"]/.test(arg)) return arg;
  return `"${arg.replaceAll('"', String.raw`\"`)}"`;
}

export interface ShortcutResult {
  ok: boolean;
  path: string;
}

export function createProfileShortcut(name: string): ShortcutResult {
  const profile = String(name || "").trim();
  if (!profile) throw new Error("A profile name is required");
  if (process.platform !== "win32") {
    throw new Error("Desktop shortcuts are only supported on Windows");
  }

  const shortcutPath = profileShortcutPath(profile);
  const ok = shell.writeShortcutLink(shortcutPath, "create", {
    target: process.execPath,
    args: profileLaunchArgs(profile).map(quoteArg).join(" "),
    description: `Launch ${profile} with RiotSwitcher`,
    icon: process.execPath,
    iconIndex: 0,
  });
  if (!ok) {
    throw new Error("Windows refused to create the shortcut");
  }
  return { ok: true, path: shortcutPath };
}

/** Profile named on the command line when a shortcut (or a second start) runs. */
export function launchProfileFromArgv(argv: string[]): string {
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === PROFILE_FLAG) {
      return String(argv[i + 1] ?? "").trim();
    }
    if (arg.startsWith(`${PROFILE_FLAG}=`)) {
      return arg.slice(PROFILE_FLAG.length + 1).trim();
    }
  }
  return "";
}
