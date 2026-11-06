import { createContext, useContext, useEffect, useState, type ReactNode } from "react";

/**
 * Whether the window is actually in front of the user.
 *
 * `document.hidden` only covers minimise / tray-hide. A window that is merely
 * covered by another app (for example a fullscreen game) is still "visible" to
 * the page but receives a window-level `blur`, so both signals are required.
 */
function windowIsActive(): boolean {
  return document.visibilityState === "visible" && document.hasFocus();
}

const AppActiveContext = createContext(true);

export function AppActiveProvider({ children }: Readonly<{ children: ReactNode }>) {
  const [active, setActive] = useState(windowIsActive);

  useEffect(() => {
    const sync = () => setActive(windowIsActive());
    window.addEventListener("focus", sync);
    window.addEventListener("blur", sync);
    window.addEventListener("pageshow", sync);
    window.addEventListener("pagehide", sync);
    document.addEventListener("visibilitychange", sync);
    sync();
    return () => {
      window.removeEventListener("focus", sync);
      window.removeEventListener("blur", sync);
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

/** Read the provider value. Defaults to `true` outside the app shell (tests, isolated cards). */
export function useAppActive(): boolean {
  return useContext(AppActiveContext);
}
