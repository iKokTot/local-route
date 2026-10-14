const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localRoute', {
  readState: () => ipcRenderer.invoke('state:read'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  toggleEngine: () => ipcRenderer.invoke('engine:toggle'),
  startVerified: () => ipcRenderer.invoke('engine:startVerified'),
  autoSelect: () => ipcRenderer.invoke('engine:autoSelect'),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),
  testStrategy: (strategy) => ipcRenderer.invoke('engine:testStrategy', strategy),
  checkUpdates: () => ipcRenderer.invoke('updates:check'),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  open: (url) => ipcRenderer.invoke('external:open', url)
});
