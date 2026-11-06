// Inertial wheel scrolling for the app's panes.
//
// Chromium scrolls a wheel notch (100 px on Windows) in one jump, which reads as
// a hard cut next to the rest of the UI. This module turns wheel input into a
// scroll *target* and lets a rAF loop ease the element towards it: the content
// keeps its momentum, decelerates, and settles instead of snapping.
//
// Rules that keep it feeling native rather than fighting the user:
//  - Trackpad deltas (small pixel values) pass through at 1:1; mouse notches get
//    a small gain so one tick covers a comfortable distance.
//  - Horizontal intent (shift+wheel, pure deltaX) and pinch (ctrl+wheel) are
//    never touched.
//  - The nearest scrollable ancestor *that can still move in that direction*
//    wins, so a pane at its end hands the wheel to the next scroller.
//  - Scrollbar drags, keyboard paging, programmatic scrolls and window blur all
//    cancel the animation immediately.
//  - `prefers-reduced-motion` disables it entirely.
//  - Any element can opt out with `data-native-scroll`.

const TAU = 95; // ms to close ~63% of the remaining distance
const MAX_FRAME = 48; // ms, so a stalled frame cannot overshoot
const SETTLE = 0.4; // px, close enough to snap
const WHEEL_GAIN = 1.12; // applied to mouse-notched deltas only
const TRACKPAD_CUTOFF = 40; // |deltaY| below this is a trackpad

const NAV_KEYS = new Set(["PageUp", "PageDown", "Home", "End", "ArrowUp", "ArrowDown", " "]);

interface Run {
  el: HTMLElement;
  cur: number;
  target: number;
  applied: number;
  raf: number;
  last: number;
}

let run: Run | null = null;
let installed = false;

/** Wheel deltas arrive in pixels, lines or pages; normalise to pixels. */
export function normalizeWheelDelta(e: WheelEvent, viewport: number): number {
  if (e.deltaMode === 1) return e.deltaY * 16;
  if (e.deltaMode === 2) return e.deltaY * viewport;
  return e.deltaY;
}

function prefersReducedMotion(): boolean {
  try {
    return window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  } catch {
    return false;
  }
}

/** Nearest ancestor that can actually scroll `dir` (1 = down, -1 = up). */
export function findScroller(start: Element | null, dir: number): HTMLElement | null {
  for (let n = start as HTMLElement | null; n; n = n.parentElement) {
    if (n.hasAttribute("data-native-scroll")) return null;
    const oy = getComputedStyle(n).overflowY;
    if (oy !== "auto" && oy !== "scroll" && oy !== "overlay") continue;
    const max = n.scrollHeight - n.clientHeight;
    if (max < 2) continue;
    const canMove = dir > 0 ? n.scrollTop < max - 1 : n.scrollTop > 0;
    if (canMove) return n;
  }
  return null;
}

function stop() {
  if (run?.raf) cancelAnimationFrame(run.raf);
  run = null;
}

function begin(el: HTMLElement): Run {
  if (run?.el === el) return run;
  stop();
  run = { el, cur: el.scrollTop, target: el.scrollTop, applied: el.scrollTop, raf: 0, last: 0 };
  return run;
}

function tick(t: number) {
  const r = run;
  if (!r) return;
  const dt = r.last ? Math.min(t - r.last, MAX_FRAME) : 16.7;
  r.last = t;
  // Exponential approach: frame-rate independent, so a dropped frame slows the
  // motion instead of teleporting it.
  r.cur += (r.target - r.cur) * (1 - Math.exp(-dt / TAU));
  if (Math.abs(r.target - r.cur) < SETTLE) r.cur = r.target;
  r.applied = r.cur;
  r.el.scrollTop = r.cur;
  if (r.cur === r.target) {
    r.raf = 0;
    run = null;
    return;
  }
  r.raf = requestAnimationFrame(tick);
}

function onWheel(e: WheelEvent) {
  if (e.defaultPrevented || e.ctrlKey || e.shiftKey || prefersReducedMotion()) return;
  const raw = normalizeWheelDelta(e, window.innerHeight);
  if (!raw) return; // horizontal-only wheel (trackpad swipe)
  const el = findScroller(e.target as Element | null, raw);
  if (!el) return;
  e.preventDefault();

  const r = begin(el);
  const gain = Math.abs(raw) >= TRACKPAD_CUTOFF ? WHEEL_GAIN : 1;
  const max = el.scrollHeight - el.clientHeight;
  r.target = Math.max(0, Math.min(max, r.target + raw * gain));
  if (!r.raf) {
    r.last = 0;
    r.raf = requestAnimationFrame(tick);
  }
}

/** Anything that moves the element outside this loop wins; drop the animation. */
function onScroll(e: Event) {
  const r = run;
  if (!r || e.target !== r.el) return;
  if (Math.abs(r.el.scrollTop - r.applied) > 2) stop();
}

/** Scrollbar drags and keyboard paging must never fight the easing. */
function onKey(e: KeyboardEvent) {
  if (NAV_KEYS.has(e.key)) stop();
}

export function installSmoothScroll(): () => void {
  if (installed) return () => undefined;
  installed = true;
  const opts = { passive: false, capture: true } as const;
  window.addEventListener("wheel", onWheel, opts);
  window.addEventListener("scroll", onScroll, true);
  window.addEventListener("pointerdown", stop, true);
  window.addEventListener("keydown", onKey, true);
  window.addEventListener("blur", stop);
  document.addEventListener("visibilitychange", stop);
  return () => {
    installed = false;
    stop();
    window.removeEventListener("wheel", onWheel, opts);
    window.removeEventListener("scroll", onScroll, true);
    window.removeEventListener("pointerdown", stop, true);
    window.removeEventListener("keydown", onKey, true);
    window.removeEventListener("blur", stop);
    document.removeEventListener("visibilitychange", stop);
  };
}
