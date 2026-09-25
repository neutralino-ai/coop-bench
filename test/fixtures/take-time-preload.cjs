const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('coopPlayer',{
  command:(name,input)=>ipcRenderer.invoke('take-time-test-command',name,input),
  onState:callback=>ipcRenderer.on('take-time-test-state',(_event,value)=>callback(value)),
  onInvitation:()=>{},
});
