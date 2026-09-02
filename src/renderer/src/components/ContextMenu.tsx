import { useEffect, useRef } from "react";

export interface MenuItem {
  id: string;
  label: string;
  danger?: boolean;
}

interface Props {
  x: number;
  y: number;
  items: MenuItem[];
  onSelect: (id: string) => void;
  onClose: () => void;
}

export function ContextMenu({ x, y, items, onSelect, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handleClick = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("mousedown", handleClick);
    window.addEventListener("keydown", handleKey);
    return () => {
      window.removeEventListener("mousedown", handleClick);
      window.removeEventListener("keydown", handleKey);
    };
  }, [onClose]);

  return (
    <div
      ref={ref}
      className="fixed z-50 min-w-[160px] rounded-md bg-bg-card border border-white/10 shadow-xl py-1"
      style={{ left: x, top: y }}
    >
      {items.map((item) => (
        <button
          key={item.id}
          onClick={() => onSelect(item.id)}
          className={`block w-full text-left px-3 py-1.5 text-xs transition-colors ${
            item.danger
              ? "text-riot-red hover:bg-riot-red/10"
              : "text-white/80 hover:bg-white/5"
          }`}
        >
          {item.label}
        </button>
      ))}
    </div>
  );
}
