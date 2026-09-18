const { contextBridge, ipcRenderer } = require('electron');

// No filesystem, raw IPC, or Electron object is exposed to the research console.
contextBridge.exposeInMainWorld('coopDesktop', Object.freeze({
  getConnection: () => ipcRenderer.invoke('coop:get-connection'),
  copyText: text => ipcRenderer.invoke('coop:copy-text', text),
}));
