import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),

  // Python backend proxy
  call: (method: string, params?: Record<string, unknown>) =>
    ipcRenderer.invoke("python:call", method, params),

  // Python event listener
  onEvent: (callback: (data: { event: string; params: unknown }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { event: string; params: unknown }) =>
      callback(data);
    ipcRenderer.on("python:event", handler);
    return () => ipcRenderer.removeListener("python:event", handler);
  },
});
