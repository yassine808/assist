import { useCallback, useEffect, useState } from "react";
import {
  getCustomColor, getScale, getTheme,
  setCustomColor as storeCustom, setScale as storeScale, setTheme as storeTheme,
} from "../lib/appearance";

/** Reactive view of the appearance prefs. */
export function useAppearance() {
  const [theme, setThemeState] = useState(getTheme);
  const [scale, setScaleState] = useState(getScale);
  const [custom, setCustomState] = useState(getCustomColor);

  useEffect(() => {
    const onStorage = () => {
      setThemeState(getTheme());
      setScaleState(getScale());
      setCustomState(getCustomColor());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const setTheme = useCallback((id: string) => { storeTheme(id); setThemeState(id); }, []);
  const setScale = useCallback((k: number) => { storeScale(k); setScaleState(getScale()); }, []);
  const setCustom = useCallback((hex: string) => {
    storeCustom(hex);
    setCustomState(getCustomColor());
    setThemeState(getTheme());
  }, []);

  return { theme, scale, custom, setTheme, setScale, setCustom };
}
