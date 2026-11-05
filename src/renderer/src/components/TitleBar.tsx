import { useEffect, useState } from "react";
import { Minus, Square, X, Settings, Map } from "lucide-react";

/** The agent-map launcher only makes sense from the home window. */
function isHomeView(): boolean {
  const view = new URLSearchParams(window.location.search).get("view");
  return view !== "settings" && view !== "agent-maps";
}

export function TitleBar() {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void window.electronAPI?.getVersion?.().then((v) => setVersion(v ?? ""));
  }, []);

  return (
    <div className="drag-region flex items-center justify-between h-10 titlebar-surface backdrop-blur border-b border-white/[0.04] shrink-0 relative overflow-hidden group/title">
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
        {/* Brand mark (same as the favicon) */}
        <svg width="20" height="20" viewBox="0 0 64 64" aria-hidden className="drop-shadow-[0_0_6px_rgba(255,70,85,0.45)]">
          <polygon points="10,0 64,0 64,54 54,64 0,64 0,10" fill="#0f1923" />
          <polygon points="12,18 36,18 36,12 52,22 36,32 36,26 12,26" fill="#ff4655" />
          <polygon points="52,46 28,46 28,52 12,42 28,32 28,38 52,38" fill="#ece8e1" />
        </svg>
        <span className="text-[12px] font-bold tracking-[0.22em] text-white/85 select-none">
          RIOTSWITCHER
        </span>
        {/* Version pill */}
        {version && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider text-white/35 bg-white/[0.04] border border-white/[0.06] uppercase">
            v{version}
          </span>
        )}
      </div>

      {/* Right: Page launchers + Window controls */}
      <div className="no-drag flex h-full">
        {isHomeView() && (
          <button
            className="w-11 h-full flex items-center justify-center text-white/30 hover:text-white/90 hover:bg-white/[0.06] transition-all duration-200"
            onClick={() => window.electronAPI.openAgentMaps()}
            aria-label="Agent Map"
          >
            <Map size={14} />
          </button>
        )}
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
