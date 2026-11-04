// @vitest-environment node
// Main-process code. Running it under jsdom would load a DOM implementation
// these tests never touch, and couples them to jsdom's release cadence.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

/**
 * Regression tests for the updater wiring.
 *
 * Original bug: `update-downloaded` offered "Restart Now" and the renderer
 * could separately fire the `update:install` IPC. Both paths called
 * `autoUpdater.quitAndInstall()` unguarded, so two installers could race on
 * the same process. The fix funnels both through a single `installOnce()`
 * latch.
 *
 * The second group pins the "always check" behaviour: packaged builds check on
 * start and then on a timer, dev builds never touch the network.
 */
function mockModules(isPackaged: boolean) {
  const checkForUpdates = vi.fn(async () => undefined);
  vi.doMock("electron-updater", () => ({
    autoUpdater: {
      logger: null,
      autoDownload: true,
      autoInstallOnAppQuit: true,
      on: vi.fn(),
      checkForUpdates,
      downloadUpdate: vi.fn(async () => undefined),
      quitAndInstall: quitAndInstallMock,
    },
  }));
  vi.doMock("electron", () => ({
    app: { isPackaged },
    BrowserWindow: class {},
    dialog: { showMessageBox: vi.fn() },
  }));
  vi.doMock("electron-log", () => ({
    default: { error: vi.fn(), warn: vi.fn(), info: vi.fn() },
  }));
  return { checkForUpdates };
}

let quitAndInstallMock: ReturnType<typeof vi.fn>;

describe("quitAndInstall re-entrancy", () => {
  beforeEach(() => {
    vi.resetModules();
    quitAndInstallMock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("invokes quitAndInstall exactly once even when called repeatedly", async () => {
    mockModules(true);

    const mod = await import("./updater");
    mod.quitAndInstall();
    mod.quitAndInstall();
    mod.quitAndInstall();

    expect(quitAndInstallMock).toHaveBeenCalledTimes(1);
  });

  it("still performs a single install when called once", async () => {
    mockModules(true);

    const mod = await import("./updater");
    mod.quitAndInstall();
    expect(quitAndInstallMock).toHaveBeenCalledTimes(1);
  });
});

describe("update checks", () => {
  beforeEach(() => {
    vi.resetModules();
    quitAndInstallMock = vi.fn();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("never queries GitHub from a development build", async () => {
    vi.useFakeTimers();
    const { checkForUpdates } = mockModules(false);

    const mod = await import("./updater");
    mod.initAutoUpdater();
    mod.checkForUpdates();
    await vi.advanceTimersByTimeAsync(60 * 60 * 1000);

    expect(checkForUpdates).not.toHaveBeenCalled();
  });

  it("checks on startup and again on the four-hour timer", async () => {
    vi.useFakeTimers();
    const { checkForUpdates } = mockModules(true);

    const mod = await import("./updater");
    mod.initAutoUpdater();

    expect(checkForUpdates).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(5000);
    expect(checkForUpdates).toHaveBeenCalledTimes(1);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(checkForUpdates).toHaveBeenCalledTimes(2);

    await vi.advanceTimersByTimeAsync(4 * 60 * 60 * 1000);
    expect(checkForUpdates).toHaveBeenCalledTimes(3);
  });
});
