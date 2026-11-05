// Dependency-free sortable engine: pointer drag + spring physics.
//
//  - Items stay in a fixed DOM order and are arranged with CSS `order`, so a reorder never
//    moves a DOM node (moving nodes would restart every card's CSS animation).
//  - Every item owns a spring (x, y, scale, rotation). When the layout changes, the item keeps its
//    *visual* position and the spring carries it to the new slot, so interrupted moves re-target
//    smoothly instead of snapping.
//  - The lifted card follows the cursor on a stiff spring, pivots around the grab point, tilts
//    with velocity and lands with a small bounce.

interface Body {
  el: HTMLElement;
  x: number; y: number; vx: number; vy: number;
  s: number; vs: number;
  r: number; vr: number;
  lx: number; ly: number; // layout position (offsetLeft/Top, unaffected by transforms)
  hasLayout: boolean;
  idle: boolean;
  lifted: boolean;
}

interface DragState {
  id: string;
  pointerId: number;
  sx: number; sy: number; // where the press started
  px: number; py: number; // latest pointer (client coords)
  gx: number; gy: number; // grab point inside the item
  active: boolean;
  startOrder: string[];
}

export interface SortableHandlers {
  /** Live order while dragging (drives CSS `order` in the view). */
  onOrderChange: (names: string[]) => void;
  /** Drag finished (or cancelled). `changed` is false when nothing moved. */
  onCommit: (names: string[], changed: boolean) => void;
  onLift?: () => void;
  onSwap?: () => void;
  onDrop?: () => void;
}

const THRESHOLD = 6;
const HYSTERESIS = 16;
const clamp = (v: number, a: number, b: number) => Math.max(a, Math.min(b, v));
const damping = (k: number, zeta: number) => 2 * Math.sqrt(k) * zeta;

export class SortableEngine {
  private bodies = new Map<string, Body>();
  private container: HTMLElement | null = null;
  private slot: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private handlers: SortableHandlers = { onOrderChange: () => undefined, onCommit: () => undefined };
  private order: string[] = [];
  private drag: DragState | null = null;
  private raf = 0;
  private last = 0;
  private awaitLayout = false;
  private suppress = false;
  private enabled = true;
  private reduce = false;

  setHandlers(h: SortableHandlers) { this.handlers = h; }
  setEnabled(v: boolean) { this.enabled = v; }
  setOrder(names: string[]) { if (!this.drag?.active) this.order = names; }

  attach(container: HTMLElement | null, slot: HTMLElement | null) {
    this.container = container;
    this.slot = slot;
    this.scroller = null;
    try { this.reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches; } catch { this.reduce = false; }
    for (let n: HTMLElement | null = container; n; n = n.parentElement) {
      const oy = getComputedStyle(n).overflowY;
      if (n !== container && (oy === "auto" || oy === "scroll")) { this.scroller = n; break; }
    }
  }

  register(id: string, el: HTMLElement | null) {
    if (!el) { this.bodies.delete(id); return; }
    const cur = this.bodies.get(id);
    if (cur?.el === el) return;
    this.bodies.set(id, { el, x: 0, y: 0, vx: 0, vy: 0, s: 1, vs: 0, r: 0, vr: 0, lx: 0, ly: 0, hasLayout: false, idle: true, lifted: false });
  }

  /** Call after any DOM/layout change (order, resize, scale). Existing items glide to their new slots. */
  layoutChanged() {
    this.awaitLayout = false;
    for (const b of this.bodies.values()) {
      const nx = b.el.offsetLeft, ny = b.el.offsetTop;
      if (!b.hasLayout) { b.lx = nx; b.ly = ny; b.hasLayout = true; continue; }
      if (nx !== b.lx || ny !== b.ly) {
        // keep the visual position; the spring will carry the item the rest of the way
        b.x += b.lx - nx;
        b.y += b.ly - ny;
        b.lx = nx; b.ly = ny;
        b.idle = false;
      }
    }
    this.syncSlot();
    this.kick();
  }

  /** True once after a drag, so the click that follows the release can be swallowed. */
  consumeSuppressedClick(): boolean {
    if (!this.suppress) return false;
    this.suppress = false;
    return true;
  }

  pointerDown(id: string, e: PointerEvent) {
    if (!this.enabled || this.drag || e.button !== 0) return;
    if ((e.target as HTMLElement).closest("button, a, input, select, textarea, [data-no-drag]")) return;
    this.drag = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, gx: 0, gy: 0, active: false, startOrder: [...this.order] };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onUp);
    window.addEventListener("keydown", this.onKey);
  }

  /** Keyboard reorder: shift an item by `delta` slots. */
  move(id: string, delta: number) {
    const from = this.order.indexOf(id);
    const to = clamp(from + delta, 0, this.order.length - 1);
    if (from < 0 || to === from) return;
    const next = [...this.order];
    next.splice(from, 1);
    next.splice(to, 0, id);
    this.order = next;
    this.handlers.onOrderChange(next);
    this.handlers.onSwap?.();
    this.handlers.onCommit(next, true);
  }

  dispose() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.detach();
    document.body.classList.remove("is-sorting");
  }

  // ── internals ──────────────────────────────────────────────────────────

  private detach() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onUp);
    window.removeEventListener("keydown", this.onKey);
  }

  private onMove = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    d.px = e.clientX; d.py = e.clientY;
    if (!d.active && Math.hypot(d.px - d.sx, d.py - d.sy) > THRESHOLD) this.activate();
    if (d.active) this.kick();
  };

  private onUp = (e: PointerEvent) => {
    const d = this.drag;
    if (!d || e.pointerId !== d.pointerId) return;
    this.finish(true);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.drag?.active) this.finish(false);
  };

  private activate() {
    const d = this.drag!;
    const b = this.bodies.get(d.id);
    if (!b) { this.drag = null; this.detach(); return; }
    const r = b.el.getBoundingClientRect();
    d.gx = d.sx - r.left;
    d.gy = d.sy - r.top;
    d.active = true;
    b.el.style.transformOrigin = `${d.gx}px ${d.gy}px`;
    b.el.classList.add("is-lifted");
    b.lifted = true;
    b.idle = false;
    document.body.classList.add("is-sorting");
    window.getSelection()?.removeAllRanges();
    if (this.slot) {
      this.slot.style.transition = "none";
      this.syncSlot();
      void this.slot.offsetWidth; // commit the un-animated position before fading in
      this.slot.style.transition = "";
      this.slot.classList.add("is-on");
    }
    this.handlers.onLift?.();
  }

  private finish(commit: boolean) {
    const d = this.drag;
    this.detach();
    this.drag = null;
    if (!d) return;
    if (!d.active) return; // a plain click / double click: leave it alone
    document.body.classList.remove("is-sorting");
    this.slot?.classList.remove("is-on");
    this.suppress = true;
    setTimeout(() => { this.suppress = false; }, 60);
    if (commit) {
      const names = [...this.order];
      this.handlers.onDrop?.();
      this.handlers.onCommit(names, names.join("\u0000") !== d.startOrder.join("\u0000"));
    } else {
      this.order = [...d.startOrder];
      this.handlers.onOrderChange(this.order);
      this.handlers.onCommit(this.order, false);
    }
    this.kick();
  }

  private syncSlot() {
    const d = this.drag;
    if (!this.slot || !d?.active) return;
    const b = this.bodies.get(d.id);
    if (!b) return;
    this.slot.style.width = `${b.el.offsetWidth}px`;
    this.slot.style.height = `${b.el.offsetHeight}px`;
    this.slot.style.transform = `translate(${b.lx}px, ${b.ly}px)`;
  }

  private kick() {
    if (!this.raf) this.raf = requestAnimationFrame(this.tick);
  }

  private hitTest(cr: DOMRect) {
    const d = this.drag!;
    if (this.awaitLayout) return;
    const px = d.px - cr.left, py = d.py - cr.top;
    const cur = this.order.indexOf(d.id);
    if (cur < 0) return;
    let best = cur, bestDist = Infinity, curDist = Infinity;
    this.order.forEach((id, i) => {
      const b = this.bodies.get(id);
      if (!b) return;
      const dist = Math.hypot(px - (b.lx + b.el.offsetWidth / 2), py - (b.ly + b.el.offsetHeight / 2));
      if (i === cur) curDist = dist;
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best === cur || bestDist > curDist - HYSTERESIS) return;
    const next = [...this.order];
    next.splice(cur, 1);
    next.splice(best, 0, d.id);
    this.order = next;
    this.awaitLayout = true;
    setTimeout(() => { this.awaitLayout = false; }, 140); // safety net if the view never re-lays out
    this.handlers.onOrderChange(next);
    this.handlers.onSwap?.();
  }

  private autoScroll(dt: number) {
    const sc = this.scroller, d = this.drag;
    if (!sc || !d) return;
    const r = sc.getBoundingClientRect();
    const zone = 90;
    const top = d.py - r.top, bottom = r.bottom - d.py;
    let v = 0;
    if (top < zone) v = -(1 - clamp(top, 0, zone) / zone);
    else if (bottom < zone) v = 1 - clamp(bottom, 0, zone) / zone;
    if (v) sc.scrollTop += v * 1100 * dt;
  }

  private tick = (t: number) => {
    this.raf = 0;
    const dt = clamp((t - (this.last || t)) / 1000, 0.001, 0.034);
    this.last = t;
    const d = this.drag?.active ? this.drag : null;
    let busy = !!d;

    let cr: DOMRect | null = null;
    if (d && this.container) {
      this.autoScroll(dt);
      cr = this.container.getBoundingClientRect();
      this.hitTest(cr);
    }

    for (const [id, b] of this.bodies) {
      const isDrag = !!d && d.id === id;
      if (b.idle && !isDrag) continue;

      let tx = 0, ty = 0, ts = 1, tr = 0;
      let kPos = this.reduce ? 900 : 330, cPos = damping(kPos, this.reduce ? 1 : 0.66);
      let kS = 520, cS = damping(kS, 0.72), kR = 260, cR = damping(kR, 0.75);
      if (isDrag && d && cr) {
        tx = d.px - cr.left - d.gx - b.lx;
        ty = d.py - cr.top - d.gy - b.ly;
        if (!this.reduce) { ts = 1.045; tr = clamp(b.vx * 0.006, -9, 9); }
        kPos = 950; cPos = damping(kPos, 0.84);
      } else if (b.lifted && !this.reduce) {
        // just dropped: a livelier landing
        kPos = 300; cPos = damping(kPos, 0.58);
      }
      if (this.reduce) { kS = 900; cS = damping(kS, 1); kR = 900; cR = damping(kR, 1); }

      const n = Math.max(1, Math.ceil(dt / (1 / 120)));
      const h = dt / n;
      for (let i = 0; i < n; i++) {
        b.vx += (kPos * (tx - b.x) - cPos * b.vx) * h; b.x += b.vx * h;
        b.vy += (kPos * (ty - b.y) - cPos * b.vy) * h; b.y += b.vy * h;
        b.vs += (kS * (ts - b.s) - cS * b.vs) * h; b.s += b.vs * h;
        b.vr += (kR * (tr - b.r) - cR * b.vr) * h; b.r += b.vr * h;
      }

      const atRest = !isDrag
        && Math.abs(b.x) < 0.08 && Math.abs(b.y) < 0.08 && Math.abs(b.vx) < 0.6 && Math.abs(b.vy) < 0.6
        && Math.abs(b.s - 1) < 0.002 && Math.abs(b.vs) < 0.03 && Math.abs(b.r) < 0.05 && Math.abs(b.vr) < 0.4;
      if (atRest) {
        b.x = b.y = b.vx = b.vy = b.vs = b.vr = 0; b.s = 1; b.r = 0;
        b.idle = true;
        b.el.style.transform = "";
        if (b.lifted) { b.lifted = false; b.el.classList.remove("is-lifted"); b.el.style.transformOrigin = ""; }
      } else {
        busy = true;
        b.el.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0) rotate(${b.r.toFixed(3)}deg) scale(${b.s.toFixed(4)})`;
      }
    }

    if (busy) this.raf = requestAnimationFrame(this.tick);
    else this.last = 0;
  };
}
