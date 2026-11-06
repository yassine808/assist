import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { SortableEngine, type SortableHandlers } from "./sortable";

/**
 * Geometry regressions for the "drag always points at the first card and never
 * moves it" bug: the engine keeps a per-item layout slot (`lx`, `ly`) that
 * hit-testing compares against. Items that were registered after the last
 * `layoutChanged()` pass had no slot, so every card reported 0,0, each slot was
 * assumed to be the first one, and no swap could ever happen.
 *
 * jsdom has no layout, so these tests hand each item the offsets a real card
 * would have in a single row.
 */

const W = 196;
const H = 600;
const STEP = 228;

function rect(left: number, top: number): DOMRect {
  return {
    left,
    top,
    right: left + W,
    bottom: top + H,
    width: W,
    height: H,
    x: left,
    y: top,
    toJSON: () => ({}),
  } as DOMRect;
}

function makeItem(col: number, row = 0): HTMLDivElement {
  const left = col * STEP;
  const top = row * (H + 40);
  const el = document.createElement("div");
  Object.defineProperty(el, "offsetLeft", { get: () => left });
  Object.defineProperty(el, "offsetTop", { get: () => top });
  Object.defineProperty(el, "offsetWidth", { get: () => W });
  Object.defineProperty(el, "offsetHeight", { get: () => H });
  el.getBoundingClientRect = () => rect(left, top);
  el.setPointerCapture = vi.fn();
  el.releasePointerCapture = vi.fn();
  document.body.appendChild(el);
  return el;
}

function pointerEvent(type: string, x: number, y: number, buttons = 1): PointerEvent {
  const e = new MouseEvent(type, { clientX: x, clientY: y, button: 0, buttons, bubbles: true, cancelable: true });
  Object.defineProperty(e, "pointerId", { value: 1 });
  return e as unknown as PointerEvent;
}

const frame = () => new Promise((r) => requestAnimationFrame(() => r(null)));

const lastOrder = (fn: SortableHandlers["onOrderChange"]): string[] =>
  (fn as unknown as { mock: { calls: [string[]][] } }).mock.calls.at(-1)![0];

describe("SortableEngine geometry", () => {
  let engine: SortableEngine;
  let handlers: SortableHandlers;
  let els: HTMLDivElement[];
  const names = ["A", "B", "C", "D"];

  function setup(measureBeforeRegister: boolean) {
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 2500,
        width: 1000,
        height: 2500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(container);

    handlers = { onOrderChange: vi.fn(), onCommit: vi.fn(), onSwap: vi.fn(), onLift: vi.fn(), onDrop: vi.fn() };
    engine = new SortableEngine();
    engine.setHandlers(handlers);
    engine.attach(container, null);
    engine.setOrder(names);
    if (measureBeforeRegister) {
      // What the real app used to do: the layout pass runs before the cards
      // register (React StrictMode re-attaches refs, cards remount).
      engine.layoutChanged();
    }
    els = names.map((_, i) => makeItem(i));
    names.forEach((n, i) => engine.register(n, els[i]));
    engine.layoutChanged();
  }

  beforeEach(() => {
    document.body.innerHTML = "";
  });

  afterEach(() => {
    engine.dispose();
  });

  it("lifts the pressed card, not the first one", () => {
    setup(false);
    engine.pointerDown("C", pointerEvent("pointerdown", 2 * STEP + 98, 300));
    window.dispatchEvent(pointerEvent("pointermove", 2 * STEP + 120, 300));

    expect(els[2].classList.contains("is-lifted")).toBe(true);
    expect(els[0].classList.contains("is-lifted")).toBe(false);
  });

  it("reorders a card past its neighbour", async () => {
    setup(false);
    engine.pointerDown("C", pointerEvent("pointerdown", 2 * STEP + 98, 300));
    for (let x = 2 * STEP + 98; x <= 3 * STEP + 98; x += 10) {
      window.dispatchEvent(pointerEvent("pointermove", x, 300));
      await frame();
      await frame();
    }

    expect(handlers.onOrderChange).toHaveBeenCalled();
    expect(lastOrder(handlers.onOrderChange)).toEqual(["A", "B", "D", "C"]);
  });

  it("reorders cards that registered after the last layout pass", async () => {
    setup(true);
    engine.pointerDown("C", pointerEvent("pointerdown", 2 * STEP + 98, 300));
    for (let x = 2 * STEP + 98; x <= 3 * STEP + 98; x += 10) {
      window.dispatchEvent(pointerEvent("pointermove", x, 300));
      await frame();
      await frame();
    }

    expect(lastOrder(handlers.onOrderChange)).toEqual(["A", "B", "D", "C"]);
  });

  it("reorders across rows, not just within one", async () => {
    document.body.innerHTML = "";
    const container = document.createElement("div");
    container.getBoundingClientRect = () =>
      ({
        left: 0,
        top: 0,
        right: 1000,
        bottom: 2500,
        width: 1000,
        height: 2500,
        x: 0,
        y: 0,
        toJSON: () => ({}),
      }) as DOMRect;
    document.body.appendChild(container);

    handlers = { onOrderChange: vi.fn(), onCommit: vi.fn(), onSwap: vi.fn(), onLift: vi.fn(), onDrop: vi.fn() };
    engine = new SortableEngine();
    engine.setHandlers(handlers);
    engine.attach(container, null);
    engine.setOrder(["A", "B", "C", "D"]);
    els = [makeItem(0, 0), makeItem(1, 0), makeItem(0, 1), makeItem(1, 1)];
    ["A", "B", "C", "D"].forEach((n, i) => engine.register(n, els[i]));
    engine.layoutChanged();

    // A (top-left) dragged onto C (below it, second row)
    engine.pointerDown("A", pointerEvent("pointerdown", 98, 300));
    for (let y = 300; y <= H + 40 + 300; y += 20) {
      window.dispatchEvent(pointerEvent("pointermove", 98, y));
      await frame();
      await frame();
    }

    expect(lastOrder(handlers.onOrderChange)).toEqual(["B", "C", "A", "D"]);
  });
});
