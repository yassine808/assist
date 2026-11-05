import { useEffect, useState } from "react";
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

  useEffect(() => {
    if (open) { setMounted(true); return; }
    const t = setTimeout(() => setMounted(false), EXIT_MS);
    return () => clearTimeout(t);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  if (!mounted) return null;

  return (
    <div
      className={`settings-backdrop ${open ? "is-open" : "is-closing"}`}
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="settings-panel modal-panel" role="dialog" aria-modal="true" aria-label="Settings">
        <button type="button" className="settings-close" onClick={onClose} aria-label="Close settings" title="Close (Esc)">
          <X size={15} />
        </button>
        <SettingsView />
      </div>
    </div>
  );
}
