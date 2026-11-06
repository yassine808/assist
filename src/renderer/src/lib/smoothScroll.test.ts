import { describe, it, expect, afterEach, beforeEach, vi } from "vitest";
import { findScroller, installSmoothScroll, normalizeWheelDelta } from "./smoothScroll";

/**
 * The wheel normaliser and the scroller picker are the two pieces that decide
 * whether Inertial scrolling helps or fights the user: the first turns line/page
 * deltas into pixels, the second hands a wheel tick to the nearest pane that can
 * still move in that direction (and lets the event through when nothing can).
 */

function wheel(deltaY: number, deltaMode = 0): WheelEvent {
  return { deltaY, deltaMode } as WheelEvent;
}

function scroller(scrollHeight: number, clientHeight: number, scrollTop: number, style = ""): HTMLDivElement {
  const el = document.createElement("div");
  el.setAttribute("style", style);
  Object.defineProperty(el, "scrollHeight", { value: scrollHeight });
  Object.defineProperty(el, "clientHeight", { value: clientHeight });
  el.scrollTop = scrollTop;
  document.body.appendChild(el);
  return el;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("normalizeWheelDelta", () => {
  it("passes pixel deltas through unchanged", () => {
    expect(normalizeWheelDelta(wheel(120), 900)).toBe(120);
  });

  it("converts line deltas to pixels", () => {
    expect(normalizeWheelDelta(wheel(3, 1), 900)).toBe(48);
  });

  it("converts page deltas using the viewport height", () => {
    expect(normalizeWheelDelta(wheel(2, 2), 900)).toBe(1800);
  });
});

describe("findScroller", () => {
  it("finds the nearest scrollable ancestor", () => {
    const pane = scroller(2000, 600, 0, "overflow-y: auto");
    const child = document.createElement("span");
    pane.appendChild(child);

    expect(findScroller(child, 1)).toBe(pane);
  });

  it("skips ancestors that cannot move in the wheel direction", () => {
    const outer = scroller(2000, 600, 0, "overflow-y: auto");
    const inner = scroller(1000, 600, 400, "overflow-y: auto");
    outer.appendChild(inner);
    const child = document.createElement("span");
    inner.appendChild(child);

    // inner is at its bottom: scrolling down belongs to the pane behind it
    expect(findScroller(child, 1)).toBe(outer);
    // scrolling up belongs to inner
    expect(findScroller(child, -1)).toBe(inner);
  });

  it("ignores elements that do not scroll vertically", () => {
    const box = scroller(2000, 600, 0, "overflow-y: hidden");
    expect(findScroller(box, 1)).toBeNull();
  });

  it("honours the data-native-scroll opt-out", () => {
    const pane = scroller(2000, 600, 0, "overflow-y: auto");
    pane.setAttribute("data-native-scroll", "");
    expect(findScroller(pane, 1)).toBeNull();
  });

  it("returns null when nothing can move, so the browser keeps the event", () => {
    const pane = scroller(600, 600, 0, "overflow-y: auto");
    expect(findScroller(pane, 1)).toBeNull();
  });
});

describe("smooth wheel animation", () => {
  let uninstall: () => void;
  let frame: FrameRequestCallback | null;
  let clock: number;

  beforeEach(() => {
    frame = null;
    clock = 0;
    vi.stubGlobal("requestAnimationFrame", (fn: FrameRequestCallback) => {
      frame = fn;
      return 1;
    });
    vi.stubGlobal("cancelAnimationFrame", () => {
      frame = null;
    });
    // jsdom's matchMedia has no reduced-motion preference
    vi.stubGlobal("matchMedia", () => ({ matches: false }) as MediaQueryList);
    uninstall = installSmoothScroll();
  });

  afterEach(() => {
    uninstall();
    vi.unstubAllGlobals();
    document.body.innerHTML = "";
  });

  /** Run one animation frame; returns false when the loop stopped. */
  function step(ms = 16): boolean {
    const cb = frame;
    if (!cb) return false;
    frame = null;
    clock += ms;
    cb(clock);
    return true;
  }

  function wheelOn(el: HTMLElement, deltaY: number) {
    const e = new WheelEvent("wheel", { deltaY, deltaMode: 0, bubbles: true, cancelable: true });
    el.dispatchEvent(e);
    return e;
  }

  it("eases towards the wheel target instead of jumping", () => {
    const pane = scroller(3000, 800, 0, "overflow-y: auto");
    const e = wheelOn(pane, 400);

    expect(e.defaultPrevented).toBe(true); // the native jump is suppressed
    expect(step()).toBe(true);
    const first = pane.scrollTop;
    expect(first).toBeGreaterThan(0);
    expect(first).toBeLessThan(448); // 400 * 1.12 target, reached over time

    const trail: number[] = [first];
    while (step()) trail.push(pane.scrollTop);

    expect(trail.length).toBeGreaterThan(3); // several frames, not one
    expect(pane.scrollTop).toBeCloseTo(448, 0);
    // monotonic, decelerating ramp
    for (let i = 1; i < trail.length; i++) expect(trail[i]).toBeGreaterThanOrEqual(trail[i - 1]);
  });

  it("accumulates a second notch while the first is still easing", () => {
    const pane = scroller(3000, 800, 0, "overflow-y: auto");
    wheelOn(pane, 200);
    step();
    wheelOn(pane, 200);

    while (step()) {
      /* run to rest */
    }
    expect(pane.scrollTop).toBeGreaterThan(448); // 400 total, plus the notch gain
    expect(pane.scrollTop).toBeLessThanOrEqual(448 + 1);
  });

  it("clamps the target to the scrollable range", () => {
    const pane = scroller(1000, 800, 150, "overflow-y: auto");
    wheelOn(pane, 5000);
    while (step()) {
      /* run to rest */
    }
    expect(pane.scrollTop).toBe(200); // scrollHeight - clientHeight
  });
});
