import { useEffect, useState } from "react";
import { Minus, Square, X, Settings, Users, Map } from "lucide-react";

export type Page = "profiles" | "agents";

interface Props {
  page: Page;
  onNavigate: (page: Page) => void;
  settingsOpen: boolean;
  onToggleSettings: () => void;
}

const TABS: { id: Page; label: string; hint: string; icon: typeof Users }[] = [
  { id: "profiles", label: "Profiles", hint: "Profiles (Ctrl+1)", icon: Users },
  { id: "agents", label: "Agent Map", hint: "Agent Map (Ctrl+2)", icon: Map },
];

export function TitleBar({ page, onNavigate, settingsOpen, onToggleSettings }: Readonly<Props>) {
  const [version, setVersion] = useState("");

  useEffect(() => {
    void window.electronAPI?.getVersion?.().then((v) => setVersion(v ?? ""));
  }, []);

  // the red underline sits on Settings while the panel is open, otherwise on the current page
  const idx = settingsOpen ? TABS.length : TABS.findIndex((t) => t.id === page);

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
        <svg width="20" height="20" viewBox="0 0 512 512" aria-hidden>
          <rect width="512" height="512" rx="116" fill="#111111" />
          <path d="M240 98H316L436 173L316 248H240L360 173Z" fill="#ffffff" />
          <path d="M272 414H196L76 339L196 264H272L152 339Z" fill="#9A9A9A" />
        </svg>
        <span className="text-[12px] font-bold tracking-[0.22em] text-white/85 select-none">
          RIOTSWITCHER
        </span>
        {version && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-bold tracking-wider text-white/35 bg-white/[0.04] border border-white/[0.06] uppercase">
            v{version}
          </span>
        )}
      </div>

      {/* Centre: page navigation */}
      <nav className="no-drag nav-tabs absolute left-1/2 -translate-x-1/2 h-full" aria-label="Pages" style={{ ["--tab" as string]: idx }}>
        {TABS.map((t) => (
          <button
            key={t.id}
            type="button"
            className={`nav-tab ${!settingsOpen && page === t.id ? "is-on" : ""}`}
            onClick={() => onNavigate(t.id)}
            title={t.hint}
            aria-current={!settingsOpen && page === t.id ? "page" : undefined}
          >
            <t.icon size={13} />
            <span>{t.label}</span>
          </button>
        ))}
        <button
          type="button"
          className={`nav-tab ${settingsOpen ? "is-on" : ""}`}
          onClick={onToggleSettings}
          title="Settings (Ctrl+,)"
          aria-pressed={settingsOpen}
        >
          <Settings size={13} className={`transition-transform duration-500 ${settingsOpen ? "rotate-90" : ""}`} />
          <span>Settings</span>
        </button>
        <span className="nav-tab-ind" aria-hidden />
      </nav>

      {/* Right: window controls */}
      <div className="no-drag flex h-full">
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
