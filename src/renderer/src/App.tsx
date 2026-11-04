import { TitleBar } from "./components/TitleBar";
import HomeView from "./views/HomeView";
import SettingsView from "./views/SettingsView";
import AgentMapView from "./views/AgentMapView";

export default function App() {
  const view = new URLSearchParams(window.location.search).get("view");

  return (
    <div className="flex flex-col h-full">
      <TitleBar />
      <main className="flex-1 overflow-y-auto">
        {view === "settings" && <SettingsView />}
        {view === "agent-maps" && <AgentMapView />}
        {view !== "settings" && view !== "agent-maps" && <HomeView />}
      </main>
    </div>
  );
}
