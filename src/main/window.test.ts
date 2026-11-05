// @vitest-environment node
// Main-process code with no DOM surface; see the note in updater.test.ts.
import { describe, it, expect, beforeEach, vi } from "vitest";

const { FakeWindow } = vi.hoisted(() => {
  class FakeWindow {
    static instances: FakeWindow[] = [];
    options: Record<string, unknown>;
    visible = false;
    private handlers = new Map<string, ((...args: unknown[]) => void)[]>();
    loadURLCalls: string[] = [];
    loadFileCalls: { path: string; options?: unknown }[] = [];

    constructor(options: Record<string, unknown>) {
      this.options = options;
      FakeWindow.instances.push(this);
    }
    once(event: string, cb: (...args: unknown[]) => void) {
      this.addHandler(event, cb);
    }
    on(event: string, cb: (...args: unknown[]) => void) {
      this.addHandler(event, cb);
    }
    emit(event: string, ...args: unknown[]) {
      for (const cb of this.handlers.get(event) ?? []) cb(...args);
    }
    isVisible() {
      return this.visible;
    }
    isDestroyed() {
      return false;
    }
    show() {
      this.visible = true;
    }
    hide() {
      this.visible = false;
    }
    loadURL(url: string) {
      this.loadURLCalls.push(url);
    }
    loadFile(path: string, options?: unknown) {
      this.loadFileCalls.push({ path, options });
    }
    lastClosePrevented = false;
    close() {
      this.lastClosePrevented = false;
      this.emit("close", {
        preventDefault: () => {
          this.lastClosePrevented = true;
        },
      });
    }
    private addHandler(event: string, cb: (...args: unknown[]) => void) {
      const list = this.handlers.get(event) ?? [];
      list.push(cb);
      this.handlers.set(event, list);
    }
  }
  return { FakeWindow };
});

vi.mock("electron", () => ({ BrowserWindow: FakeWindow }));
vi.mock("./python-bridge", () => ({ PythonBridge: class {} }));

import { createAppWindow } from "./window";

function fakePython(config: Record<string, unknown> = { CloseToTray: true, MinimizeToTray: false }) {
  return { call: vi.fn(async () => config) };
}

function closeEvent() {
  return { preventDefault: vi.fn() };
}

describe("app window close-to-tray", () => {
  beforeEach(() => {
    FakeWindow.instances.length = 0;
    delete process.env.ELECTRON_RENDERER_URL;
  });

  it("caps the width so the lobby never reflows past four cards", async () => {
    await createAppWindow(fakePython() as never, { onCloseToTray: vi.fn() });
    const options = FakeWindow.instances[0]!.options;
    expect(options.maxWidth).toBe(1210);
    expect(options.minWidth).toBe(900);
    expect(options.frame).toBe(false);
  });

  it("hides to the tray instead of closing when CloseToTray is on", async () => {
    const onCloseToTray = vi.fn();
    const { win } = await createAppWindow(fakePython() as never, { onCloseToTray });
    const event = closeEvent();

    win.emit("close", event);

    expect(event.preventDefault).toHaveBeenCalledOnce();
    expect(onCloseToTray).toHaveBeenCalledWith("close");
  });

  it("lets the window close when CloseToTray is off", async () => {
    const onCloseToTray = vi.fn();
    const { win } = await createAppWindow(
      fakePython({ CloseToTray: false, MinimizeToTray: false }) as never,
      { onCloseToTray }
    );
    const event = closeEvent();

    win.emit("close", event);

    expect(event.preventDefault).not.toHaveBeenCalled();
    expect(onCloseToTray).not.toHaveBeenCalled();
  });

  it("permitClose lets an app-level quit through the tray interceptor", async () => {
    const { win, permitClose } = await createAppWindow(fakePython() as never, {
      onCloseToTray: vi.fn(),
    });

    permitClose();
    const event = closeEvent();
    win.emit("close", event);

    expect(event.preventDefault).not.toHaveBeenCalled();
  });

  it("requestClose closes the window directly", async () => {
    const { requestClose } = await createAppWindow(fakePython() as never, {
      onCloseToTray: vi.fn(),
    });

    requestClose();

    expect(FakeWindow.instances[0]!.lastClosePrevented).toBe(false);
  });

  it("minimizes to the tray when MinimizeToTray is on", async () => {
    const onCloseToTray = vi.fn();
    const { win } = await createAppWindow(
      fakePython({ CloseToTray: true, MinimizeToTray: true }) as never,
      { onCloseToTray }
    );

    win.emit("minimize");

    expect(win.isVisible()).toBe(false);
    expect(onCloseToTray).toHaveBeenCalledWith("minimize");
  });
});
