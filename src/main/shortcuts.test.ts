// @vitest-environment node
// Main-process helpers; see the note in updater.test.ts.
import { join } from "node:path";
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const { writeShortcutLink, desktop } = vi.hoisted(() => ({
  writeShortcutLink: vi.fn(),
  desktop: "C:\\Users\\Test\\Desktop",
}));

vi.mock("electron", () => ({
  app: {
    isPackaged: false,
    getAppPath: () => "D:\\Projects\\Assist",
    getPath: () => desktop,
  },
  shell: { writeShortcutLink },
}));

import {
  createProfileShortcut,
  launchProfileFromArgv,
  profileLaunchArgs,
  profileShortcutPath,
  sanitizeShortcutName,
} from "./shortcuts";

const realPlatform = process.platform;

describe("profile desktop shortcuts", () => {
  beforeEach(() => {
    writeShortcutLink.mockReset();
    // Shortcuts are Windows-only; run the same logic on every CI runner.
    Object.defineProperty(process, "platform", { value: "win32", configurable: true });
  });

  afterEach(() => {
    Object.defineProperty(process, "platform", { value: realPlatform, configurable: true });
  });

  it("strips characters Windows rejects from the file name", () => {
    expect(sanitizeShortcutName('Bad/Name: "x"|?*')).toBe("Bad_Name_ _x____");
  });

  it("drops trailing dots and spaces instead of silently renaming the file", () => {
    expect(sanitizeShortcutName("Player. ")).toBe("Player");
  });

  it("falls back to a usable name when everything was stripped", () => {
    expect(sanitizeShortcutName("...")).toBe("Profile");
  });

  it("builds the shortcut in the Desktop folder", () => {
    expect(profileShortcutPath("Main", desktop)).toBe(join(desktop, "RiotSwitcher - Main.lnk"));
  });

  it("passes the app path as well as the profile when running from source", () => {
    expect(profileLaunchArgs("Main")).toEqual(["D:\\Projects\\Assist", "--profile", "Main"]);
  });

  it("reads both --profile forms from argv", () => {
    expect(launchProfileFromArgv(["app.exe", "--profile", "Main"])).toBe("Main");
    expect(launchProfileFromArgv(["app.exe", "--profile=Alt"])).toBe("Alt");
    expect(launchProfileFromArgv(["app.exe"])).toBe("");
  });

  it("creates a .lnk that restarts the executable on the profile", () => {
    writeShortcutLink.mockReturnValue(true);

    const result = createProfileShortcut("Main Account");

    expect(result.ok).toBe(true);
    expect(result.path).toBe(join(desktop, "RiotSwitcher - Main Account.lnk"));
    expect(writeShortcutLink).toHaveBeenCalledWith(
      result.path,
      "create",
      expect.objectContaining({
        target: process.execPath,
        args: 'D:\\Projects\\Assist --profile "Main Account"',
        description: "Launch Main Account with RiotSwitcher",
      }),
    );
  });

  it("reports a Windows failure instead of pretending the shortcut exists", () => {
    writeShortcutLink.mockReturnValue(false);
    expect(() => createProfileShortcut("Main")).toThrow(/refused/i);
  });

  it("rejects an empty profile name", () => {
    expect(() => createProfileShortcut("  ")).toThrow(/profile name/i);
  });
});
