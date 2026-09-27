import { describe, it, expect, beforeEach, vi } from "vitest";

/**
 * Regression test for the secondary-window singleton leak.
 *
 * Original bug: `openViewWindow` created a BrowserWindow but never called the
 * `setCurrent` callback, so the `current()` guard could never hit. Every
 * click on "Settings" or "Agent Maps" leaked another BrowserWindow.
 *
 * This imports the real `src/main/window.ts` with a fake BrowserWindow, so
 * deleting the `setCurrent(win)` line in the source fails these tests.
 */

const instances: FakeWin[] = [];

class FakeWindow {
  destroyed = false;
  minimized = false;
  focusCount = 0;
  showCount = 0;
  private handlers: Record<string, (() => void)[]> = {};

  constructor(public options: Record<string, unknown>) {
    instances.push(this);
  }
  isDestroyed() {
    return this.destroyed;
  }
  isMinimized() {
    return this.minimized;
  }
  restore() {
    this.minimized = false;
  }
  focus() {
    this.focusCount++;
  }
  show() {
    this.showCount++;
  }
  once(ev: string, cb: () => void) {
    (this.handlers[ev] ??= []).push(cb);
  }
  on(ev: string, cb: () => void) {
    (this.handlers[ev] ??= []).push(cb);
  }
  emit(ev: string) {
    for (const cb of this.handlers[ev] ?? []) cb();
  }
  loadURLCalls: string[] = [];
  loadFileCalls: { path: string; options?: unknown }[] = [];
  loadURL(url: string) {
    this.loadURLCalls.push(url);
  }
  loadFile(path: string, options?: unknown) {
    this.loadFileCalls.push({ path, options });
  }
}

vi.mock("electron", () => ({
  BrowserWindow: FakeWindow,
  shell: { openExternal: vi.fn() },
  ipcMain: { handle: vi.fn(), on: vi.fn() },
  app: { getPath: vi.fn(() => ""), on: vi.fn(), quit: vi.fn() },
}));

vi.mock("./python-bridge", () => ({ PythonBridge: class {} }));

type FakeWin = InstanceType<typeof FakeWindow>;

async function loadWindowModule() {
  vi.resetModules();
  return await import("./window");
}

describe("secondary window singleton", () => {
  beforeEach(() => {
    instances.length = 0;
    // window.ts picks its load strategy from this, so a leaked value would make
    // the packaged-branch assertions depend on test execution order.
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("reuses the existing settings window instead of leaking a new one", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    w.openSettingsWindow({} as never);
    w.openSettingsWindow({} as never);
    expect(instances).toHaveLength(1);
  });

  it("reuses the existing agent map window", async () => {
    const w = await loadWindowModule();
    w.openAgentMapWindow();
    w.openAgentMapWindow();
    expect(instances).toHaveLength(1);
  });

  it("keeps settings and agent-map windows separate", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    w.openAgentMapWindow();
    expect(instances).toHaveLength(2);
  });

  it("focuses the existing window on repeat open", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    w.openSettingsWindow({} as never);
    expect(instances[0]!.focusCount).toBe(1);
  });

  it("restores a minimized window before focusing it", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    instances[0]!.minimized = true;
    w.openSettingsWindow({} as never);
    expect(instances[0]!.minimized).toBe(false);
    expect(instances[0]!.focusCount).toBe(1);
  });

  it("opens a fresh window after the previous one closes", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    instances[0]!.emit("closed");
    w.openSettingsWindow({} as never);
    expect(instances).toHaveLength(2);
  });

  it("opens a fresh window if the tracked one was destroyed without a close event", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    instances[0]!.destroyed = true;
    w.openSettingsWindow({} as never);
    expect(instances).toHaveLength(2);
  });

  it("passes the view through as a query parameter, not a hash", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    // view selection drives the renderer's routing; keep it on the query string
    expect(instances[0]!.loadFileCalls).toHaveLength(1);
    const call = instances[0]!.loadFileCalls[0]!;
    expect(call.path).toContain("index.html");
    // A hash fragment is invisible to the renderer's URLSearchParams lookup,
    // which silently falls back to the main view.
    expect(call.path).not.toContain("#");
    expect(call.options).toEqual({ query: { view: "settings" } });
    expect(instances[0]!.showCount).toBe(0); // starts hidden until ready-to-show
    instances[0]!.emit("ready-to-show");
    expect(instances[0]!.showCount).toBe(1);
  });

  it("carries each view's own name in the packaged load", async () => {
    const w = await loadWindowModule();
    w.openSettingsWindow({} as never);
    w.openAgentMapWindow();
    expect(instances[0]!.loadFileCalls[0]!.options).toEqual({
      query: { view: "settings" },
    });
    expect(instances[1]!.loadFileCalls[0]!.options).toEqual({
      query: { view: "agent-maps" },
    });
  });

  it("appends the view to ELECTRON_RENDERER_URL in dev", async () => {
    process.env.ELECTRON_RENDERER_URL = "http://localhost:5173";
    try {
      const w = await loadWindowModule();
      w.openAgentMapWindow();
      expect(instances[0]!.loadURLCalls).toEqual([
        "http://localhost:5173?view=agent-maps",
      ]);
      // The dev branch must not fall through to loadFile as well.
      expect(instances[0]!.loadFileCalls).toHaveLength(0);
    } finally {
      delete process.env.ELECTRON_RENDERER_URL;
    }
  });
});
