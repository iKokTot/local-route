const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('localRoute', {
  readState: () => ipcRenderer.invoke('state:read'),
  saveProfile: (profile) => ipcRenderer.invoke('profile:save', profile),
  toggleEngine: () => ipcRenderer.invoke('engine:toggle'),
  startVerified: () => ipcRenderer.invoke('engine:startVerified'),
  autoSelect: () => ipcRenderer.invoke('engine:autoSelect'),
  stopEngine: () => ipcRenderer.invoke('engine:stop'),
  testStrategy: (strategy) => ipcRenderer.invoke('engine:testStrategy', strategy),
  setAutoStart: (enabled) => ipcRenderer.invoke('autostart:set', enabled),
  saveLaunchSettings: (settings) => ipcRenderer.invoke('launch:save', settings),
  autoSelectServer: () => ipcRenderer.invoke('vless:autoSelect'),
  checkServers: (id) => ipcRenderer.invoke('vless:checkServers', id),
  cancelServerCheck: () => ipcRenderer.invoke('vless:cancelCheck'),
  subscriptionClipboard: () => ipcRenderer.invoke('vless:subscriptionClipboard'),
  importVless: (raw) => ipcRenderer.invoke('vless:import', raw),
  removeSubscription: (id) => ipcRenderer.invoke('vless:removeSubscription', id),
  selectVless: (id) => ipcRenderer.invoke('vless:select', id),
  saveVless: (raw) => ipcRenderer.invoke('vless:save', raw),
  deleteVless: () => ipcRenderer.invoke('vless:delete'),
  pickApplication: () => ipcRenderer.invoke('applications:pick'),
  exportDiagnostics: () => ipcRenderer.invoke('diagnostics:export'),
  onProgress: (callback) => {
    const listener = (_event, progress) => callback(progress);
    ipcRenderer.on('operation:progress', listener);
    return () => ipcRenderer.removeListener('operation:progress', listener);
  },
  toggleVless: () => ipcRenderer.invoke('vless:toggle'),
  startVless: () => ipcRenderer.invoke('vless:start'),
  stopVless: () => ipcRenderer.invoke('vless:stop'),
  testVless: () => ipcRenderer.invoke('vless:test'),
  testVlessSpeed: () => ipcRenderer.invoke('vless:speed'),
  startAll: () => ipcRenderer.invoke('network:startAll'),
  stopAll: () => ipcRenderer.invoke('network:stopAll'),
  saveTelegram: (raw) => ipcRenderer.invoke('telegram:save', raw),
  startTelegram: () => ipcRenderer.invoke('telegram:start'),
  stopTelegram: () => ipcRenderer.invoke('telegram:stop'),
  connectTelegram: () => ipcRenderer.invoke('telegram:connect'),
  copyTelegram: () => ipcRenderer.invoke('telegram:copy'),
  open: (url) => ipcRenderer.invoke('external:open', url)
});
