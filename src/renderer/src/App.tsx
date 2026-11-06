import { useCallback, useEffect, useState, type ReactNode } from "react";
import { hydrateFromConfig } from "./lib/appearance";
import { AppActiveProvider } from "./hooks/useAppActive";
import { TitleBar, type Page } from "./components/TitleBar";
import { ToastProvider } from "./components/Toast";
import SettingsOverlay from "./components/SettingsOverlay";
import HomeView from "./views/HomeView";
import AgentMapView from "./views/AgentMapView";
import { BeamsBackground } from "./components/ui/beams-background";

/** A full-size scrolling page. Inactive pages stay mounted (state and layout kept) but are hidden. */
function Pane({ active, children }: Readonly<{ active: boolean; children: ReactNode }>) {
  return (
    <div className={`view-pane ${active ? "is-active" : ""}`} aria-hidden={!active}>
      {children}
    </div>
  );
}

export default function App() {
  const [page, setPage] = useState<Page>("profiles");
  const [visited, setVisited] = useState<Record<Page, boolean>>({ profiles: true, agents: false });
  const [settingsOpen, setSettingsOpen] = useState(false);

  const navigate = useCallback((p: Page) => {
    setVisited((v) => (v[p] ? v : { ...v, [p]: true }));
    setPage(p);
    setSettingsOpen(false);
  }, []);
  const toggleSettings = useCallback(() => setSettingsOpen((o) => !o), []);
  const closeSettings = useCallback(() => setSettingsOpen(false), []);

  useEffect(() => {
    void window.electronAPI
      ?.call?.("get_config")
      .then((cfg) => hydrateFromConfig(cfg as Record<string, unknown> | null))
      .catch(() => undefined);
  }, []);

  // Keyboard navigation: Ctrl+1 / Ctrl+2 switch pages, Ctrl+, toggles settings.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey || e.shiftKey) return;
      if (e.key === "1") {
        e.preventDefault();
        navigate("profiles");
      } else if (e.key === "2") {
        e.preventDefault();
        navigate("agents");
      } else if (e.key === ",") {
        e.preventDefault();
        toggleSettings();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [navigate, toggleSettings]);

  return (
    <AppActiveProvider>
      <ToastProvider>
        <BeamsBackground />
        <div className="flex flex-col h-full relative z-10">
          <TitleBar page={page} onNavigate={navigate} settingsOpen={settingsOpen} onToggleSettings={toggleSettings} />
          <main className="app-main">
            <Pane active={page === "profiles"}>
              <HomeView />
            </Pane>
            {visited.agents && (
              <Pane active={page === "agents"}>
                <AgentMapView />
              </Pane>
            )}
            <SettingsOverlay open={settingsOpen} onClose={closeSettings} />
          </main>
        </div>
      </ToastProvider>
    </AppActiveProvider>
  );
}
