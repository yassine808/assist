'use strict';

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('as', {
  list: () => ipcRenderer.invoke('accounts:list'),
  tierMeta: () => ipcRenderer.invoke('accounts:tier-meta'),
  active: () => ipcRenderer.invoke('accounts:active'),
  addCurrent: () => ipcRenderer.invoke('accounts:add-current'),
  refresh: (puuid) => ipcRenderer.invoke('accounts:refresh', puuid),
  switchTo: (puuid) => ipcRenderer.invoke('accounts:switch', puuid),
  remove: (puuid) => ipcRenderer.invoke('accounts:remove', puuid),
  tracker: (account) => ipcRenderer.invoke('accounts:tracker', account),
});
