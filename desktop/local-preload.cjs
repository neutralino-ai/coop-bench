const { contextBridge, ipcRenderer } = require('electron');

// No filesystem, raw IPC, or Electron object is exposed to the research console.
contextBridge.exposeInMainWorld('coopDesktop', Object.freeze({
  updateInfo: () => ipcRenderer.invoke('coop:update-info'),
  checkUpdate: () => ipcRenderer.invoke('coop:update-check'),
  downloadUpdate: () => ipcRenderer.invoke('coop:update-download'),
  installUpdate: () => ipcRenderer.invoke('coop:update-install'),
  getConnection: () => ipcRenderer.invoke('coop:get-connection'),
  copyText: text => ipcRenderer.invoke('coop:copy-text', text),
}));
