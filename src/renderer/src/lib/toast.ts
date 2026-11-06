import { createContext, useContext } from "react";

export type ToastKind = "success" | "error" | "info" | "loading";

export interface ToastOptions {
  /** Reusing an id updates that toast in place (e.g. loading -> success). */
  id?: string;
  kind?: ToastKind;
  title: string;
  message?: string;
  /** ms before auto-dismiss. Loading toasts stay until updated or dismissed. */
  duration?: number;
}

export interface ToastApi {
  show: (opts: ToastOptions) => string;
  update: (id: string, patch: Partial<Omit<ToastOptions, "id">>) => void;
  dismiss: (id: string) => void;
}

// Without a provider (e.g. isolated component tests) the API quietly does nothing.
const noop: ToastApi = { show: () => "", update: () => undefined, dismiss: () => undefined };

export const ToastContext = createContext<ToastApi>(noop);

export const useToast = (): ToastApi => useContext(ToastContext);
