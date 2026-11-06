// Dependency-free sortable engine: pointer drag + spring physics.
//
//  - Items stay in a fixed DOM order and are arranged with CSS `order`, so a reorder never
//    moves a DOM node (moving nodes would restart every card's CSS animation).
//  - Every item owns a spring (x, y, scale, rotation). When the layout changes, the item keeps its
//    *visual* position and the spring carries it to the new slot, so interrupted moves re-target
//    smoothly instead of snapping.
//  - The lifted card follows the cursor on a stiff spring (no tilt) and lands with a small bounce.
//  - Slots are derived from the items' own layout positions, sorted in reading order. That set of
//    positions is the same before and after any reorder, so hit-testing can never see stale geometry
//    (even when the pointer moves faster than React re-renders).

interface Body {
  el: HTMLElement;
  x: number; y: number; vx: number; vy: number;
  s: number; vs: number;
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

interface SpringTarget {
  tx: number; ty: number; ts: number;
  kPos: number; cPos: number;
  kS: number; cS: number;
}

function atRest(b: Body, isDrag: boolean): boolean {
  if (isDrag) return false;
  return Math.abs(b.x) < 0.25
    && Math.abs(b.y) < 0.25
    && Math.abs(b.vx) < 1.6
    && Math.abs(b.vy) < 1.6
    && Math.abs(b.s - 1) < 0.002
    && Math.abs(b.vs) < 0.03;
}

export class SortableEngine {
  private readonly bodies = new Map<string, Body>();
  private container: HTMLElement | null = null;
  private slot: HTMLElement | null = null;
  private scroller: HTMLElement | null = null;
  private handlers: SortableHandlers = { onOrderChange: () => undefined, onCommit: () => undefined };
  private order: string[] = [];
  private drag: DragState | null = null;
  private raf = 0;
  private last = 0;
  private suppress = false;
  private enabled = true;
  private reduce = false;
  private captured: HTMLElement | null = null;

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
    const cur = this.bodies.get(id);
    if (!el) {
      if (!cur) return;
      if (this.drag?.id === id) this.abortDrag();
      this.releaseEl(cur);
      this.bodies.delete(id);
      return;
    }
    if (cur?.el === el) return;
    if (cur) {
      // Same card, new DOM node (remount / HMR): carry the animation state over
      // instead of dropping a lift that is still in flight and leaving the old
      // node stuck with `is-lifted` and a stale transform.
      const body: Body = {
        el, x: cur.x, y: cur.y, vx: cur.vx, vy: cur.vy, s: cur.s, vs: cur.vs,
        lx: cur.lx, ly: cur.ly, hasLayout: cur.hasLayout, idle: cur.idle, lifted: cur.lifted,
      };
      if (cur.lifted) {
        el.classList.add("is-lifted");
        el.style.transform = cur.el.style.transform;
        el.style.transformOrigin = cur.el.style.transformOrigin;
      }
      this.releaseEl(cur);
      this.bodies.set(id, body);
      if (!body.idle || body.lifted) this.kick();
      return;
    }
    this.bodies.set(id, { el, x: 0, y: 0, vx: 0, vy: 0, s: 1, vs: 0, lx: 0, ly: 0, hasLayout: false, idle: true, lifted: false });
  }

  /** Clear the drag chrome a body may still carry on its element. */
  private releaseEl(b: Body) {
    b.el.classList.remove("is-lifted");
    b.el.style.transform = "";
    b.el.style.transformOrigin = "";
  }

  /** Call after any DOM/layout change (order, resize, scale). Existing items glide to their new slots. */
  layoutChanged() {
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
    if (!this.enabled || e.button !== 0) return;
    // A drag whose pointerup was lost (released outside the window, alt-tab)
    // used to leave `this.drag` set forever, which made every later press a
    // no-op and kept the stuck card following the cursor. Clear it first.
    if (this.drag) this.finish(false);
    if ((e.target as HTMLElement | null)?.closest("button, a, input, select, textarea, [data-no-drag]")) return;
    this.drag = { id, pointerId: e.pointerId, sx: e.clientX, sy: e.clientY, px: e.clientX, py: e.clientY, gx: 0, gy: 0, active: false, startOrder: [...this.order] };
    window.addEventListener("pointermove", this.onMove);
    window.addEventListener("pointerup", this.onUp);
    window.addEventListener("pointercancel", this.onCancel);
    window.addEventListener("keydown", this.onKey);
    window.addEventListener("blur", this.onBlur);
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
    this.drag = null;
    for (const b of this.bodies.values()) this.releaseEl(b);
    document.body.classList.remove("is-sorting");
    this.slot?.classList.remove("is-on");
  }

  // ── internals ──────────────────────────────────────────────────────────

  private detach() {
    window.removeEventListener("pointermove", this.onMove);
    window.removeEventListener("pointerup", this.onUp);
    window.removeEventListener("pointercancel", this.onCancel);
    window.removeEventListener("keydown", this.onKey);
    window.removeEventListener("blur", this.onBlur);
  }

  private onMove = (e: PointerEvent) => {
    if (e.pointerId !== this.drag?.pointerId) return;
    const d = this.drag!;
    // The button was released while the pointer was outside the window, so
    // pointerup never reached us: finish the drag instead of letting the card
    // chase the cursor forever.
    if (e.buttons === 0) {
      if (d.active) this.finish(true);
      else this.cancelPending();
      return;
    }
    d.px = e.clientX; d.py = e.clientY;
    if (!d.active && Math.hypot(d.px - d.sx, d.py - d.sy) > THRESHOLD) this.activate();
    if (d.active) this.kick();
  };

  private onUp = (e: PointerEvent) => {
    if (e.pointerId !== this.drag?.pointerId) return;
    this.finish(true);
  };

  private onCancel = (e: PointerEvent) => {
    if (e.pointerId !== this.drag?.pointerId) return;
    this.finish(false);
  };

  /** Window lost focus mid-drag: put everything back instead of leaving a stuck card. */
  private onBlur = () => {
    if (this.drag) this.finish(false);
  };

  private onKey = (e: KeyboardEvent) => {
    if (e.key === "Escape" && this.drag?.active) this.finish(false);
  };

  private cancelPending() {
    this.detach();
    this.drag = null;
  }

  /**
   * The lifted card's element disappeared mid-drag (its ref was detached). Drop
   * the drag quietly: release the capture, clear the chrome and put the order
   * back. Callbacks are skipped because this can run while React is unmounting.
   */
  private abortDrag() {
    const d = this.drag;
    this.detach();
    this.drag = null;
    if (d) {
      if (this.captured) {
        try { this.captured.releasePointerCapture(d.pointerId); } catch { /* element may be gone */ }
        this.captured = null;
      }
      this.order = [...d.startOrder];
    }
    document.body.classList.remove("is-sorting");
    this.slot?.classList.remove("is-on");
  }

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
    // Capture the pointer so pointerup still arrives when the cursor leaves the
    // window while the button is held. Without this the drag could be lost.
    try {
      b.el.setPointerCapture(d.pointerId);
      this.captured = b.el;
    } catch {
      this.captured = null;
    }
    document.body.classList.add("is-sorting");
    window.getSelection()?.removeAllRanges();
    if (this.slot) {
      this.slot.style.transition = "none";
      this.syncSlot();
      // Re-enable the transition on the next frame so the slot fades in from
      // its freshly committed, un-animated position.
      requestAnimationFrame(() => {
        if (!this.slot) return;
        this.slot.style.transition = "";
        this.slot.classList.add("is-on");
      });
    }
    this.handlers.onLift?.();
  }

  private finish(commit: boolean) {
    const d = this.drag;
    this.detach();
    this.drag = null;
    if (!d) return;
    if (!d.active) return; // a plain click / double click: leave it alone
    if (this.captured) {
      try { this.captured.releasePointerCapture(d.pointerId); } catch { /* element may be gone */ }
      this.captured = null;
    }
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
    const me = this.bodies.get(d.id);
    const cur = this.order.indexOf(d.id);
    if (!me || cur < 0) return;

    // Slot positions in reading order (row by row). Independent of which item currently sits in which slot.
    const slots = this.order
      .map((id) => this.bodies.get(id))
      .filter((b): b is Body => !!b)
      .map((b) => ({ x: b.lx + b.el.offsetWidth / 2, y: b.ly + b.el.offsetHeight / 2 }))
      .sort((a, b) => a.y - b.y || a.x - b.x);
    if (slots.length !== this.order.length) return;
    // Unlaid-out grid (hidden pane, display:none): every slot is at 0,0. Treat
    // that as "no geometry" instead of reordering everything to the first slot.
    if (slots.length > 1 && slots[0].x === slots.at(-1)!.x && slots[0].y === slots.at(-1)!.y) return;

    // Where the lifted card's centre is right now (it is what "covers" the other cards).
    const cx = d.px - cr.left - d.gx + me.el.offsetWidth / 2;
    const cy = d.py - cr.top - d.gy + me.el.offsetHeight / 2;

    // The physical slot the card currently sits in, by geometry. `order` can be
    // one React render ahead of the CSS `order`, so its index is not reliable
    // for this comparison.
    const mcx = me.lx + me.el.offsetWidth / 2;
    const mcy = me.ly + me.el.offsetHeight / 2;
    let curSlot = 0, curSlotDist = Infinity;
    slots.forEach((s, i) => {
      const dist = Math.hypot(mcx - s.x, mcy - s.y);
      if (dist < curSlotDist) { curSlotDist = dist; curSlot = i; }
    });

    let best = curSlot, bestDist = Infinity;
    const curDist = Math.hypot(cx - slots[curSlot].x, cy - slots[curSlot].y);
    slots.forEach((s, i) => {
      const dist = Math.hypot(cx - s.x, cy - s.y);
      if (dist < bestDist) { bestDist = dist; best = i; }
    });
    if (best === curSlot || bestDist > curDist - HYSTERESIS) return;

    const next = [...this.order];
    next.splice(cur, 1);
    next.splice(best, 0, d.id);
    this.order = next;
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
    const cr = this.trackDrag(d, dt);

    for (const [id, b] of this.bodies) {
      if (this.stepBody(id, b, d, cr, dt)) busy = true;
    }

    if (busy) this.raf = requestAnimationFrame(this.tick);
    else this.last = 0;
  };

  /** Scroll near the edges and return the container rect used for targets. */
  private trackDrag(d: DragState | null, dt: number): DOMRect | null {
    if (!d || !this.container) return null;
    this.autoScroll(dt);
    const cr = this.container.getBoundingClientRect();
    this.hitTest(cr);
    return cr;
  }

  private stepBody(id: string, b: Body, d: DragState | null, cr: DOMRect | null, dt: number): boolean {
    const isDrag = d?.id === id;
    if (b.idle && !isDrag && !b.lifted) return false;
    this.integrate(b, dt, this.targetFor(b, isDrag, d, cr));
    return this.settleBody(b, isDrag);
  }

  private targetFor(b: Body, isDrag: boolean, d: DragState | null, cr: DOMRect | null): SpringTarget {
    let tx = 0, ty = 0, ts = 1;
    let kPos = this.reduce ? 900 : 440;
    let cPos = damping(kPos, this.reduce ? 1 : 0.8);
    let kS = 520;
    let cS = damping(kS, 0.72);
    if (isDrag && d && cr) {
      tx = d.px - cr.left - d.gx - b.lx;
      ty = d.py - cr.top - d.gy - b.ly;
      if (!this.reduce) ts = 1.045;
      kPos = 950;
      cPos = damping(kPos, 0.84);
    } else if (b.lifted && !this.reduce) {
      // just dropped: a livelier landing
      kPos = 400;
      cPos = damping(kPos, 0.66);
    }
    if (this.reduce) { kS = 900; cS = damping(kS, 1); }
    return { tx, ty, ts, kPos, cPos, kS, cS };
  }

  private integrate(b: Body, dt: number, target: SpringTarget) {
    const { tx, ty, ts, kPos, cPos, kS, cS } = target;
    const n = Math.max(1, Math.ceil(dt / (1 / 120)));
    const h = dt / n;
    for (let i = 0; i < n; i++) {
      b.vx += (kPos * (tx - b.x) - cPos * b.vx) * h;
      b.x += b.vx * h;
      b.vy += (kPos * (ty - b.y) - cPos * b.vy) * h;
      b.y += b.vy * h;
      b.vs += (kS * (ts - b.s) - cS * b.vs) * h;
      b.s += b.vs * h;
    }
  }

  /** Returns true while the body is still moving (and a frame is needed). */
  private settleBody(b: Body, isDrag: boolean): boolean {
    if (atRest(b, isDrag)) {
      b.x = b.y = b.vx = b.vy = b.vs = 0;
      b.s = 1;
      b.idle = true;
      b.el.style.transform = "";
      if (b.lifted) {
        b.lifted = false;
        b.el.classList.remove("is-lifted");
        b.el.style.transformOrigin = "";
      }
      return false;
    }
    b.el.style.transform = `translate3d(${b.x.toFixed(2)}px, ${b.y.toFixed(2)}px, 0) scale(${b.s.toFixed(4)})`;
    return true;
  }
}
