import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("electronAPI", {
  // Window controls
  minimize: () => ipcRenderer.invoke("window:minimize"),
  close: () => ipcRenderer.invoke("window:close"),
  toggleMaximize: () => ipcRenderer.invoke("window:toggleMaximize"),

  // Auto-updater
  checkUpdate: () => ipcRenderer.invoke("update:check"),
  downloadUpdate: () => ipcRenderer.invoke("update:download"),
  installUpdate: () => ipcRenderer.invoke("update:install"),
  onUpdateStatus: (callback: (data: { state: string; version?: string; message?: string; percent?: number }) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, data: { state: string; version?: string; message?: string; percent?: number }) =>
      callback(data);
    ipcRenderer.on("update:status", handler);
    return () => ipcRenderer.removeListener("update:status", handler);
  },

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
