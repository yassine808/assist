import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SortableEngine, type SortableHandlers } from "./sortable";

/**
 * Regression for the "cards stop being draggable and jump to the first slot"
 * bug. The engine listens for pointerup on the window; when the mouse button
 * is released outside the window that event never arrives. The drag stayed
 * active forever, `body.is-sorting` disabled pointer events on every other
 * card, and the stuck card kept chasing the cursor into slot 0.
 *
 * These tests pin the escape hatches: a pointermove with no buttons, window
 * blur, and a new pointerdown all end (or replace) a stale drag.
 */

function pointerEvent(
  type: string,
  opts: { x?: number; y?: number; buttons?: number; pointerId?: number } = {}
): PointerEvent {
  const e = new MouseEvent(type, {
    clientX: opts.x ?? 0,
    clientY: opts.y ?? 0,
    button: 0,
    buttons: opts.buttons ?? 1,
    bubbles: true,
    cancelable: true,
  });
  Object.defineProperty(e, "pointerId", { value: opts.pointerId ?? 1 });
  return e as unknown as PointerEvent;
}

function makeItem(): HTMLDivElement {
  const el = document.createElement("div");
  document.body.appendChild(el);
  return el;
}

describe("SortableEngine pointer lifecycle", () => {
  let engine: SortableEngine;
  let handlers: SortableHandlers;
  let a: HTMLDivElement;
  let b: HTMLDivElement;

  beforeEach(() => {
    handlers = {
      onOrderChange: vi.fn(),
      onCommit: vi.fn(),
      onLift: vi.fn(),
      onSwap: vi.fn(),
      onDrop: vi.fn(),
    };
    engine = new SortableEngine();
    engine.setHandlers(handlers);
    a = makeItem();
    b = makeItem();
    engine.attach(document.body, null);
    engine.register("A", a);
    engine.register("B", b);
    engine.setOrder(["A", "B"]);
    engine.layoutChanged();
    document.body.className = "";
  });

  afterEach(() => {
    engine.dispose();
    a.remove();
    b.remove();
  });

  function startDrag(target = "A") {
    engine.pointerDown(target, pointerEvent("pointerdown", { x: 10, y: 10 }));
    window.dispatchEvent(pointerEvent("pointermove", { x: 40, y: 40 }));
  }

  it("ends the drag when the button is released outside the window", () => {
    startDrag();
    expect(handlers.onLift).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("is-sorting")).toBe(true);

    window.dispatchEvent(pointerEvent("pointermove", { x: 60, y: 60, buttons: 0 }));

    expect(handlers.onCommit).toHaveBeenCalledTimes(1);
    expect(document.body.classList.contains("is-sorting")).toBe(false);

    // The next press must still work (it used to be ignored forever).
    startDrag();
    expect(handlers.onLift).toHaveBeenCalledTimes(2);
  });

  it("cancels the drag when the window loses focus", () => {
    startDrag();
    window.dispatchEvent(new Event("blur"));

    expect(handlers.onCommit).toHaveBeenCalledWith(["A", "B"], false);
    expect(document.body.classList.contains("is-sorting")).toBe(false);
  });

  it("replaces a pending press instead of ignoring the next one", () => {
    engine.pointerDown("A", pointerEvent("pointerdown", { x: 10, y: 10 }));
    // released without ever moving: no pointerup reached the engine
    engine.pointerDown("B", pointerEvent("pointerdown", { x: 10, y: 10 }));
    window.dispatchEvent(pointerEvent("pointermove", { x: 40, y: 40 }));

    expect(handlers.onLift).toHaveBeenCalledTimes(1);
  });

  it("captures and releases the pointer for a real drag", () => {
    const capture = vi.fn();
    const release = vi.fn();
    a.setPointerCapture = capture;
    a.releasePointerCapture = release;

    startDrag();
    expect(capture).toHaveBeenCalledWith(1);

    window.dispatchEvent(pointerEvent("pointerup", { x: 40, y: 40 }));
    expect(release).toHaveBeenCalledWith(1);
  });
});
