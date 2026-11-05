import { useEffect } from "react";
import { hydrateFromConfig } from "./lib/appearance";
import { TitleBar } from "./components/TitleBar";
import { ToastProvider } from "./components/Toast";
import HomeView from "./views/HomeView";
import SettingsView from "./views/SettingsView";
import AgentMapView from "./views/AgentMapView";

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view");

  useEffect(() => {
    void window.electronAPI?.call?.("get_config")
      .then((cfg) => hydrateFromConfig(cfg as Record<string, unknown> | null))
      .catch(() => undefined);
  }, []);

  return (
    <ToastProvider>
      <div className="flex flex-col h-full">
        <TitleBar />
        <main className="flex-1 overflow-y-auto">
          {view === "settings" && <SettingsView />}
          {view === "agent-maps" && <AgentMapView />}
          {view !== "settings" && view !== "agent-maps" && <HomeView />}
        </main>
      </div>
    </ToastProvider>
  );
}
