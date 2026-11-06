import { useEffect, useRef, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";

interface Props {
  open: boolean;
  onClose: () => void;
  title: string;
  eyebrow?: string;
  icon?: ReactNode;
  /** "danger" tints the icon and accent red-hot. */
  tone?: "default" | "danger" | "success";
  width?: number;
  /** When false, Esc / outside click / the X do nothing (e.g. while saving). */
  dismissible?: boolean;
  children: ReactNode;
  footer?: ReactNode;
}

const EXIT_MS = 260;

/**
 * Shared dialog: blurred backdrop + panel that pops in and fades away, exactly like Settings.
 * Esc and an outside click close it; the element marked `data-autofocus` gets focus on open.
 */
export default function Modal({ open, onClose, title, eyebrow, icon, tone = "default", width = 440, dismissible = true, children, footer }: Readonly<Props>) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open || !mounted) return;
    const focus = setTimeout(() => {
      const el = panelRef.current?.querySelector<HTMLElement>("[data-autofocus]");
      (el ?? panelRef.current)?.focus({ preventScroll: true });
    }, 60);
    return () => clearTimeout(focus);
  }, [open, mounted]);

  useEffect(() => {
    if (!open || !dismissible) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") { e.stopPropagation(); onClose(); }
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey, true);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey, true);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, dismissible, onClose]);

  if (!mounted) return null;

  return createPortal(
    <div className={`rs-modal-backdrop ${open ? "is-open" : "is-closing"}`}>
      <dialog
        ref={panelRef}
        open
        className={`rs-modal modal-panel p-0 tone-${tone}`}
        style={{ ["--w" as string]: `${width}px` }}
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
      >
        <header className="rs-modal-head">
          {icon && <span className="rs-modal-icon">{icon}</span>}
          <div className="rs-modal-titles">
            {eyebrow && <div className="rs-modal-eyebrow">{eyebrow}</div>}
            <h2 className="rs-modal-title">{title}</h2>
          </div>
          <button type="button" className="rs-modal-x" onClick={onClose} disabled={!dismissible} aria-label="Close" title="Close (Esc)">
            <X size={15} />
          </button>
        </header>
        <div className="rs-modal-body">{children}</div>
        {footer && <footer className="rs-modal-foot">{footer}</footer>}
      </dialog>
    </div>,
    document.body
  );
}
