import { useCallback, useMemo, useRef, useState, type ReactNode } from "react";
import { ToastContext, type ToastApi, type ToastKind, type ToastOptions } from "../lib/toast";

interface ToastItem extends Required<Pick<ToastOptions, "id" | "kind" | "title">> {
  message: string;
  duration: number;
  stamp: number; // bumps on every update so the countdown bar restarts
  leaving: boolean;
}

const MAX_VISIBLE = 4;
const EXIT_MS = 380;
const DEFAULT_MS: Record<ToastKind, number> = { success: 3800, info: 4200, error: 6500, loading: 0 };

function Icon({ kind }: Readonly<{ kind: ToastKind }>) {
  const common = {
    width: 16,
    height: 16,
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 2.4,
    strokeLinecap: "round",
    strokeLinejoin: "round",
    "aria-hidden": true,
    focusable: "false",
  } as const;
  if (kind === "success")
    return (
      <svg {...common}>
        <path className="toast-check" d="M5 12.5l4.2 4.2L19 7.5" />
      </svg>
    );
  if (kind === "error")
    return (
      <svg {...common}>
        <path d="M12 7v6M12 17h.01" />
        <path d="M10.3 3.9 2.4 17.5A2 2 0 0 0 4.1 20.5h15.8a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0z" />
      </svg>
    );
  if (kind === "loading") return <span className="toast-spinner" />;
  return (
    <svg {...common}>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 11v5M12 8h.01" />
    </svg>
  );
}

function ToastCard({ t, onClose }: Readonly<{ t: ToastItem; onClose: (id: string) => void }>) {
  return (
    <div className={`toast-wrap ${t.leaving ? "is-leaving" : "is-in"}`}>
      <div className="toast-clip">
        <output className={`toast toast-${t.kind}`} role={t.kind === "error" ? "alert" : undefined}>
          <span className="toast-accent" />
          <span className="toast-icon">
            <Icon kind={t.kind} />
          </span>
          <div className="toast-body">
            <div className="toast-title">{t.title}</div>
            {t.message && <div className="toast-msg">{t.message}</div>}
          </div>
          <button className="toast-close" onClick={() => onClose(t.id)} aria-label="Dismiss">
            <svg
              width="11"
              height="11"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2.6"
              strokeLinecap="round"
              aria-hidden="true"
              focusable="false"
            >
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
          {t.kind === "loading" ? (
            <span className="toast-bar toast-bar-indeterminate" />
          ) : (
            <span
              key={t.stamp}
              className="toast-bar"
              style={{ animationDuration: `${t.duration}ms` }}
              onAnimationEnd={() => onClose(t.id)}
            />
          )}
        </output>
      </div>
    </div>
  );
}

export function ToastProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const seq = useRef(0);
  const removeTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());

  const removeLater = useCallback((id: string) => {
    if (removeTimers.current.has(id)) return;
    removeTimers.current.set(
      id,
      setTimeout(() => {
        removeTimers.current.delete(id);
        setItems((prev) => prev.filter((t) => t.id !== id));
      }, EXIT_MS),
    );
  }, []);

  const dismiss = useCallback(
    (id: string) => {
      setItems((prev) => prev.map((t) => (t.id === id && !t.leaving ? { ...t, leaving: true } : t)));
      removeLater(id);
    },
    [removeLater],
  );

  const show = useCallback(
    (opts: ToastOptions): string => {
      const id = opts.id ?? `toast-${++seq.current}`;
      const kind = opts.kind ?? "info";
      const duration = opts.duration ?? DEFAULT_MS[kind];
      setItems((prev) => {
        const next: ToastItem = {
          id,
          kind,
          title: opts.title,
          message: opts.message ?? "",
          duration,
          stamp: ++seq.current,
          leaving: false,
        };
        const exists = prev.some((t) => t.id === id);
        let list = exists ? prev.map((t) => (t.id === id ? next : t)) : [...prev, next];
        const live = list.filter((t) => !t.leaving);
        if (live.length > MAX_VISIBLE) {
          const drop = new Set(live.slice(0, live.length - MAX_VISIBLE).map((t) => t.id));
          list = list.map((t) => (drop.has(t.id) ? { ...t, leaving: true } : t));
          drop.forEach(removeLater);
        }
        return list;
      });
      // A re-shown toast must not be removed by an earlier pending exit.
      const pending = removeTimers.current.get(id);
      if (pending) {
        clearTimeout(pending);
        removeTimers.current.delete(id);
      }
      return id;
    },
    [removeLater],
  );

  const update = useCallback((id: string, patch: Partial<Omit<ToastOptions, "id">>) => {
    setItems((prev) =>
      prev.map((t) => {
        if (t.id !== id) return t;
        const kind = patch.kind ?? t.kind;
        return {
          ...t,
          kind,
          title: patch.title ?? t.title,
          message: patch.message ?? t.message,
          duration: patch.duration ?? DEFAULT_MS[kind],
          stamp: ++seq.current,
          leaving: false,
        };
      }),
    );
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, update, dismiss }), [show, update, dismiss]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="toast-stack" aria-live="polite">
        {items.map((t) => (
          <ToastCard key={t.id} t={t} onClose={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}
