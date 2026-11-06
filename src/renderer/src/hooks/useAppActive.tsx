import { useEffect, useState, type ReactNode } from "react";
import { AppActiveContext } from "./appActiveContext";

/**
 * Whether the window is actually on screen.
 *
 * `document.visibilityState` is the occlusion-aware signal: Chromium turns the
 * page hidden when the window is minimised, hidden to tray, or completely
 * covered by another window. Merely losing focus (another app is open beside
 * the window) keeps it `visible`, so animations are not paused just because the
 * user clicked elsewhere.
 */
function windowIsActive(): boolean {
  return document.visibilityState === "visible";
}

export function AppActiveProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [active, setActive] = useState(windowIsActive);

  useEffect(() => {
    const sync = () => setActive(windowIsActive());
    window.addEventListener("pageshow", sync);
    window.addEventListener("pagehide", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      window.removeEventListener("pageshow", sync);
      window.removeEventListener("pagehide", sync);
      document.removeEventListener("visibilitychange", sync);
    };
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("app-inactive", !active);
    return () => document.documentElement.classList.remove("app-inactive");
  }, [active]);

  return <AppActiveContext.Provider value={active}>{children}</AppActiveContext.Provider>;
}
