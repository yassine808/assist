import { Minus, Square, X } from "lucide-react";

export function TitleBar() {
  return (
    <div className="drag-region flex items-center justify-between h-9 bg-bg-dark border-b border-white/5 shrink-0">
      <div className="flex items-center px-3 gap-2">
        <span className="w-2.5 h-2.5 rounded-full bg-riot-red dark:bg-riot-red" />
        <span className="text-xs font-semibold tracking-wide text-white/70 select-none">
          RIOTSWITCHER
        </span>
      </div>
      <div className="no-drag flex h-full">
        <button
          className="w-11 h-full flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          onClick={() => window.electronAPI.minimize()}
          aria-label="Minimize"
        >
          <Minus size={15} />
        </button>
        <button
          className="w-11 h-full flex items-center justify-center text-white/50 hover:bg-white/10 hover:text-white transition-colors"
          onClick={() => window.electronAPI.toggleMaximize()}
          aria-label="Maximize"
        >
          <Square size={12} />
        </button>
        <button
          className="w-11 h-full flex items-center justify-center text-white/50 hover:bg-riot-red hover:text-white transition-colors"
          onClick={() => window.electronAPI.close()}
          aria-label="Close"
        >
          <X size={16} />
        </button>
      </div>
    </div>
  );
}
