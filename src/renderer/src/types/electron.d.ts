export {};

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
    };
  }
}
