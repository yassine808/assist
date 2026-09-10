import { Minus, Square, X, Settings } from "lucide-react";

export function TitleBar() {
  return (
    <div className="drag-region flex items-center justify-between h-10 bg-[#0c0f16] border-b border-white/[0.04] shrink-0 relative overflow-hidden group/title">
      {/* Animated gradient line at bottom */}
      <div className="absolute bottom-0 left-0 right-0 h-[1px] z-10">
        <div
          className="absolute inset-0"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,70,85,0.5) 20%, rgba(255,70,85,0.9) 50%, rgba(255,70,85,0.5) 80%, transparent 100%)',
          }}
        />
        <div
          className="absolute inset-0 opacity-0 group-hover/title:opacity-100 transition-opacity duration-500"
          style={{
            background: 'linear-gradient(90deg, transparent 0%, rgba(255,70,85,0.8) 30%, rgba(255,150,50,0.6) 50%, rgba(255,70,85,0.8) 70%, transparent 100%)',
            filter: 'blur(2px)',
          }}
        />
      </div>

      {/* Left: Logo + brand */}
      <div className="flex items-center px-3 gap-2.5">
        {/* Animated orb */}
        <div className="relative w-5 h-5 flex items-center justify-center">
          <div className="absolute inset-0 rounded-full bg-riot-red/20 animate-pulse" />
          <div className="w-2.5 h-2.5 rounded-full bg-riot-red shadow-[0_0_8px_rgba(255,70,85,0.6)]" />
        </div>
        <span
          className="text-[11px] font-bold tracking-[0.15em] text-white/80 select-none"
          style={{ fontFamily: "'Rajdhani', sans-serif" }}
        >
          RIOTSWITCHER
        </span>
        {/* Version pill */}
        <span className="px-1.5 py-0.5 rounded-full text-[8px] font-bold tracking-wider text-white/30 bg-white/[0.04] border border-white/[0.06] uppercase">
          v2.1
        </span>
      </div>

      {/* Right: Settings + Window controls */}
      <div className="no-drag flex h-full">
        <button
          className="w-11 h-full flex items-center justify-center text-white/30 hover:text-white/90 hover:bg-white/[0.06] transition-all duration-200"
          onClick={() => window.electronAPI.openSettings()}
          aria-label="Settings"
        >
          <Settings size={14} />
        </button>
        <button
          className="w-11 h-full flex items-center justify-center text-white/30 hover:text-white/90 hover:bg-white/[0.06] transition-all duration-200 relative group/btn"
          onClick={() => window.electronAPI.minimize()}
          aria-label="Minimize"
        >
          <Minus size={14} className="group-hover/btn:scale-110 transition-transform duration-150" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 group-hover/btn:w-4 h-[2px] bg-white/30 rounded-full transition-all duration-200" />
        </button>
        <button
          className="w-11 h-full flex items-center justify-center text-white/30 hover:text-white/90 hover:bg-white/[0.06] transition-all duration-200 relative group/btn"
          onClick={() => window.electronAPI.toggleMaximize()}
          aria-label="Maximize"
        >
          <Square size={10} className="group-hover/btn:scale-110 transition-transform duration-150" />
          <div className="absolute bottom-0 left-1/2 -translate-x-1/2 w-0 group-hover/btn:w-4 h-[2px] bg-white/30 rounded-full transition-all duration-200" />
        </button>
        <button
          className="w-11 h-full flex items-center justify-center text-white/30 hover:text-white hover:bg-[#e81123] transition-all duration-200 relative group/btn"
          onClick={() => window.electronAPI.close()}
          aria-label="Close"
        >
          <X size={15} className="group-hover/btn:scale-110 transition-transform duration-150" />
        </button>
      </div>
    </div>
  );
}
