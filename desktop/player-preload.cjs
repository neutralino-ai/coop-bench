const {contextBridge,ipcRenderer}=require('electron');
contextBridge.exposeInMainWorld('coopPlayer',Object.freeze({
  command:async(name,input)=>{const reply=await ipcRenderer.invoke('player:command',{name,input});if(!reply.ok)throw Error(reply.error);return reply.value;},
  onState:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('player:state',listener);return ()=>ipcRenderer.removeListener('player:state',listener);},
  onInvitation:callback=>{const listener=(_event,value)=>callback(value);ipcRenderer.on('player:invitation',listener);return ()=>ipcRenderer.removeListener('player:invitation',listener);},
}));
