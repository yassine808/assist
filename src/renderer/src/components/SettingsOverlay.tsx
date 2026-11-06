import { useEffect, useRef, useState } from "react";
import { X } from "lucide-react";
import SettingsView from "../views/SettingsView";

interface Props {
  open: boolean;
  onClose: () => void;
}

const EXIT_MS = 260;

/** Settings live inside the main window: a blurred backdrop with a floating panel. */
export default function SettingsOverlay({ open, onClose }: Readonly<Props>) {
  const [mounted, setMounted] = useState(open);
  const panelRef = useRef<HTMLDialogElement>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (!panelRef.current?.contains(e.target as Node)) onClose();
    };
    window.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onDown);
    return () => {
      window.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onDown);
    };
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div className={`settings-backdrop ${open ? "is-open" : "is-closing"}`}>
      <dialog ref={panelRef} open className="settings-panel modal-panel p-0" aria-modal="true" aria-label="Settings">
        <button
          type="button"
          className="settings-close"
          onClick={onClose}
          aria-label="Close settings"
          title="Close (Esc)"
        >
          <X size={15} />
        </button>
        <SettingsView />
      </dialog>
    </div>
  );
}
