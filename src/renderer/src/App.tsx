import { Routes, Route, useLocation } from "react-router-dom";
import { TitleBar } from "./components/TitleBar";
import { Sidebar } from "./components/Sidebar";
import HomeView from "./views/HomeView";
import SettingsView from "./views/SettingsView";
import AddAccountView from "./views/AddAccountView";

export default function App() {
  const location = useLocation();

  return (
    <div className="flex flex-col h-full bg-bg-dark">
      <TitleBar />
      <div className="flex flex-1 overflow-hidden">
        <Sidebar />
        <main className="flex-1 overflow-y-auto bg-bg-dark">
          <Routes location={location}>
            <Route path="/" element={<HomeView />} />
            <Route path="/settings" element={<SettingsView />} />
            <Route path="/add-account" element={<AddAccountView />} />
          </Routes>
        </main>
      </div>
    </div>
  );
}
