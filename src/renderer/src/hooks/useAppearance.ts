import { useCallback, useEffect, useState } from "react";
import {
  getCustomColor,
  getScale,
  getTheme,
  setCustomColor as storeCustom,
  setScale as storeScale,
  setTheme as storeTheme,
} from "../lib/appearance";

/** Reactive view of the appearance prefs. */
export function useAppearance() {
  const [theme, setTheme] = useState(getTheme);
  const [scale, setScale] = useState(getScale);
  const [custom, setCustom] = useState(getCustomColor);

  useEffect(() => {
    const onStorage = () => {
      setTheme(getTheme());
      setScale(getScale());
      setCustom(getCustomColor());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const changeTheme = useCallback((id: string) => {
    storeTheme(id);
    setTheme(id);
  }, []);
  const changeScale = useCallback((k: number) => {
    storeScale(k);
    setScale(getScale());
  }, []);
  const changeCustom = useCallback((hex: string) => {
    storeCustom(hex);
    setCustom(getCustomColor());
    setTheme(getTheme());
  }, []);

  return { theme, scale, custom, setTheme: changeTheme, setScale: changeScale, setCustom: changeCustom };
}
