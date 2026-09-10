import { TitleBar } from "./components/TitleBar";
import HomeView from "./views/HomeView";
import SettingsView from "./views/SettingsView";

export default function App() {
  const isSettings = new URLSearchParams(window.location.search).get("view") === "settings";

  return (
    <div className="flex flex-col h-full bg-bg-dark">
      <TitleBar />
      <main className="flex-1 overflow-y-auto bg-bg-dark">
        {isSettings ? <SettingsView /> : <HomeView />}
      </main>
    </div>
  );
}
