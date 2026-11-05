import { useCallback, useEffect, useState } from "react";
import { getScale, getTheme, setScale as storeScale, setTheme as storeTheme } from "../lib/appearance";

/** Reactive view of the appearance prefs (used by the settings window). */
export function useAppearance() {
  const [theme, setThemeState] = useState(getTheme);
  const [scale, setScaleState] = useState(getScale);

  useEffect(() => {
    const onStorage = () => {
      setThemeState(getTheme());
      setScaleState(getScale());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((id: string) => {
    storeTheme(id);
    setThemeState(id);
  }, []);
  const setScale = useCallback((k: number) => {
    storeScale(k);
    setScaleState(getScale());
  }, []);

  return { theme, scale, setTheme, setScale };
}
