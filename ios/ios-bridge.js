/* Injected into a locally bundled, non-navigable WKWebView before page scripts.
 * Each view exposes one role only. Native code independently checks that role. */
(()=>{
 const pending=new Map(),listeners={state:[],invitation:[]};let sequence=0;
 const invoke=(name,input={})=>new Promise((resolve,reject)=>{const id=String(++sequence);pending.set(id,{resolve,reject});window.webkit.messageHandlers.coop.postMessage({id,name,input});});
 window.__coopReply=(id,value,error)=>{const p=pending.get(id);if(!p)return;pending.delete(id);if(error)p.reject(Object.assign(Error(error.message),{code:error.code,status:error.status}));else{if(typeof value?.bodyBase64==='string'){const text=atob(value.bodyBase64),bytes=new Uint8Array(text.length);for(let i=0;i<text.length;i++)bytes[i]=text.charCodeAt(i);value={...value,bytes};delete value.bodyBase64;}p.resolve(value);}};
 window.__coopEvent=(name,value)=>{for(const fn of listeners[name]??[])fn(value);};
 const listen=name=>fn=>{listeners[name].push(fn);return ()=>{listeners[name]=listeners[name].filter(x=>x!==fn);};};
 if(window.__coopRole==='player')window.coopPlayer=Object.freeze({command:invoke,onState:listen('state'),onInvitation:listen('invitation')});
 else window.coopDesktop=Object.freeze(Object.assign(Object.fromEntries(['getConnection','connect','login','register','operatorCommand','getAccount','setPassword','disconnect','request','cancelRequest','copyText','openPlayer','incomingInvitation'].map(name=>[name,input=>invoke(name,input)])),{hostSeat:(name,input)=>invoke('hostSeat',{name,input}),onInvitation:listen('invitation')}));
 window.addEventListener('DOMContentLoaded',()=>{
  document.body.classList.add('ios-client');
  const note=document.createElement('p');note.className='ios-foreground-note';note.textContent='参赛时保持应用在前台；切到后台不会暂停服务器倒计时。';document.body.append(note);
  const updates=document.querySelector('.update-section');if(updates){const section=document.createElement('section');section.className='settings-section';const title=document.createElement('h3');title.textContent='iOS 客户端';const hint=document.createElement('p');hint.textContent='通过 TestFlight 安装的版本，请在 TestFlight 中更新。自行构建的版本可通过 Xcode 更新。';section.append(title,hint);updates.after(section);}
 });
})();
