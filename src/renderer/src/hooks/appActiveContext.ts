import { createContext, useContext } from "react";

export const AppActiveContext = createContext(true);

/** Read the provider value. Defaults to `true` outside the app shell (tests, isolated cards). */
export function useAppActive(): boolean {
  return useContext(AppActiveContext);
}
