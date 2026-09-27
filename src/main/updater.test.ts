import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Regression test for double-quit during update install.
 *
 * Original bug: `update-downloaded` offered "Restart Now" and the renderer
 * could separately fire the `update:install` IPC. Both paths called
 * `autoUpdater.quitAndInstall()` unguarded, so two installers could race on
 * the same process. The fix funnels both through a single `installOnce()`
 * latch.
 */
interface FakeUpdater {
  quitAndInstall: ReturnType<typeof vi.fn>;
}

describe("quitAndInstall re-entrancy", () => {
  let quitAndInstall: FakeUpdater["quitAndInstall"];

  beforeEach(() => {
    vi.resetModules();
    quitAndInstall = vi.fn();
  });

  it("invokes quitAndInstall exactly once even when called repeatedly", async () => {
    vi.doMock("electron-updater", () => ({
      autoUpdater: {
        logger: null,
        autoDownload: true,
        autoInstallOnAppQuit: true,
        on: vi.fn(),
        checkForUpdates: vi.fn(async () => undefined),
        downloadUpdate: vi.fn(async () => undefined),
        quitAndInstall,
      },
    }));
    vi.doMock("electron", () => ({
      BrowserWindow: class {},
      dialog: { showMessageBox: vi.fn() },
    }));
    vi.doMock("electron-log", () => ({ default: { error: vi.fn() } }));

    const mod = await import("./updater");
    mod.quitAndInstall();
    mod.quitAndInstall();
    mod.quitAndInstall();

    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });

  it("still performs a single install when called once", async () => {
    vi.doMock("electron-updater", () => ({
      autoUpdater: {
        logger: null,
        autoDownload: true,
        autoInstallOnAppQuit: true,
        on: vi.fn(),
        checkForUpdates: vi.fn(async () => undefined),
        downloadUpdate: vi.fn(async () => undefined),
        quitAndInstall,
      },
    }));
    vi.doMock("electron", () => ({
      BrowserWindow: class {},
      dialog: { showMessageBox: vi.fn() },
    }));
    vi.doMock("electron-log", () => ({ default: { error: vi.fn() } }));

    const mod = await import("./updater");
    mod.quitAndInstall();
    expect(quitAndInstall).toHaveBeenCalledTimes(1);
  });
});
