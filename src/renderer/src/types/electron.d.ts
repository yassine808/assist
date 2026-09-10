export {};

declare module '*.css' {}

declare global {
  interface Window {
    electronAPI: {
      minimize: () => Promise<void>;
      close: () => Promise<void>;
      toggleMaximize: () => Promise<void>;
      call: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
      onEvent: (
        callback: (data: { event: string; params: unknown }) => void
      ) => () => void;
      checkUpdate: () => Promise<void>;
      downloadUpdate: () => Promise<void>;
      installUpdate: () => Promise<void>;
      onUpdateStatus: (
        callback: (data: { state: string; version?: string; message?: string; percent?: number }) => void
      ) => () => void;
      openSettings: () => Promise<void>;
    };
  }
}
