import {BrowserWindow,clipboard,ipcMain,safeStorage} from 'electron';
import {createHash,randomUUID} from 'node:crypto';
import {existsSync,mkdirSync,readFileSync,writeFileSync,unlinkSync} from 'node:fs';
import {join} from 'node:path';
import {PlayerRuntime,inviteUrl} from '../runtime/coop-bench/client/player.mjs';
import {ClientConnectionError} from './remote-session.mjs';

// Only the account claims the seat. The playing window gets no account bridge,
// credentials, audit state, or other players' private observations.
export class LobbyPlayer {
  window=null;runtime=null;busy=false;credentials=null;scope=null;
  constructor({remote,directory,preload,show=true}) {
    this.remote=remote;this.directory=directory;this.preload=preload;this.show=show;
    mkdirSync(directory,{recursive:true});
    ipcMain.handle('player:command',async(event,{name,input={}}={})=>{
      if(!this.window||event.sender!==this.window.webContents||event.senderFrame!==this.window.webContents.mainFrame||event.senderFrame.url!=='coop://app/player.html')throw Error('Untrusted player window.');
      try {
        if(JSON.stringify(input).length>65536)throw Error('输入过大。');
        if(name==='incoming-invitation')return {ok:true,value:''};
        if(name==='status')return {ok:true,value:this.snapshot()};
        if(name==='disconnect'){await this.stop();return {ok:true,value:this.snapshot()};}
        if(name==='resume'){await this.open({});return {ok:true,value:this.snapshot()};}
        if(!this.runtime)throw Error('请回到大厅，选择“加入对局”或“返回我的对局”。');
        if(name==='ready')await this.runtime.ready(input.ready!==false);
        else if(name==='start')await this.runtime.roomCommand('start');
        else if(name==='kick')await this.runtime.roomCommand('kick',{playerId:input.playerId});
        else if(name==='invite'){const room=await this.runtime.roomCommand('invite');clipboard.writeText(inviteUrl({...room,apiUrl:this.credentials.apiUrl}));return {ok:true,value:{copied:true}};}
        else if(name==='leave'){
          await this.runtime.roomCommand('leave');await this.stop();
          const file=this.file(this.scope);if(existsSync(file))unlinkSync(file);this.credentials=null;
        }
        else if(name==='act')await this.runtime.act(input.action,input.observationId);
        else throw Error('请在大厅选择对局；此窗口由你自己操作。');
        return {ok:true,value:this.snapshot()};
      } catch(error) {return {ok:false,error:error.code?this.error(error.code):String(error.message).slice(0,200)};}
    });
  }
  error(code){return ({INVALID_SEAT_TOKEN:'Seat token 无效或已被重新发放，请向房主索取当前席位密钥。',ROOM_FULL:'房间已满，请刷新大厅。',ROOM_CLOSED:'房间已经开始或已过期，请刷新大厅。',STALE_ROSTER:'成员已变化，请重新确认并准备。',NOT_READY:'需要所有玩家入席并准备后才能开始。',FORBIDDEN:'此房间未开放人类加入，或你没有此操作权限。',NOT_FOUND:'房间不存在，请刷新大厅。',BUILD_MISMATCH:'房间属于旧版服务，请创建新房间。'})[code]??'操作未完成，请检查连接并刷新本席状态。';}
  file(scope){return join(this.directory,scope+'.encrypted');}
  saved(scope){if(scope===this.scope&&this.credentials)return this.credentials;try{if(safeStorage.isEncryptionAvailable())return JSON.parse(safeStorage.decryptString(readFileSync(this.file(scope))));}catch{}return null;}
  snapshot(){return this.runtime?{...this.runtime.snapshot(),mode:'human',autoReady:true}:{status:'disconnected',canResume:Boolean(this.credentials),mode:'human',lobbyManaged:true};}
  async open(input={}) {
    const {remote}=this;
    if(!remote.token||!remote.identity)throw new ClientConnectionError('LOGIN_REQUIRED','请先登录大厅。');
    if(this.busy)throw new ClientConnectionError('PLAYER_BUSY','正在加入对局，请稍候。');
    const scope=createHash('sha256').update(JSON.stringify([remote.apiUrl,remote.identity.id])).digest('hex');
    if(input.roomId&&!/^[A-Za-z0-9_-]{43,128}$/.test(input.seatToken??''))throw new ClientConnectionError('INVALID_SEAT_TOKEN','请输入 43–128 位有效 seat token。');
    if(this.runtime){
      if(this.scope!==scope||input.roomId&&this.credentials.roomId!==input.roomId)throw new ClientConnectionError('PLAYER_BUSY','你已加入另一场对局，请先在参赛窗口离开或断开。');
      if(input.roomId&&input.seatToken!==this.credentials.playerToken)throw new ClientConnectionError('SEAT_MISMATCH','此窗口已有席位，请使用原 seat token 或先离开房间。');
      if(this.show){this.window?.show();this.window?.focus();}return {opened:true};
    }
    if(input.roomId!==undefined&&!/^[a-f0-9-]{36}$/.test(input.roomId))throw new ClientConnectionError('INVALID_ROOM','无效房间。');
    const prior=this.saved(scope);
    const config=input.roomId?{apiUrl:remote.apiUrl,roomId:input.roomId,name:String(input.name??'玩家').trim(),playerToken:input.seatToken}:prior;
    if(!config)throw new ClientConnectionError('NO_SEAT','没有可恢复的席位，请从大厅加入对局。');
    if(!config.name||config.name.length>60)throw new ClientConnectionError('INVALID_NAME','请输入 1–60 字的玩家名字。');
    this.busy=true;const epoch=remote.epoch;let next;
    try {
      if(input.roomId){
        const response=await remote.request({id:randomUUID(),path:`/api/v1/lobby/${config.roomId}/join`,method:'POST',body:{name:config.name,playerToken:config.playerToken}});
        let result;try{result=JSON.parse(Buffer.from(response.bytes).toString());}catch{throw new ClientConnectionError('LOBBY_UNAVAILABLE','服务器尚未提供大厅功能，请更新服务端。');}
        if(response.status!==200)throw new ClientConnectionError('JOIN_FAILED',response.status===404?'服务器尚未提供大厅功能，或房间已不存在。':this.error(result?.error?.code));
      }
      if(epoch!==remote.epoch)throw new ClientConnectionError('CANCELLED','登录已改变，请重新打开大厅。');
      // A rejected pasted key must not overwrite the last recoverable seat.
      this.scope=scope;this.credentials=config;
      if(safeStorage.isEncryptionAvailable())writeFileSync(this.file(scope),safeStorage.encryptString(JSON.stringify(config)),{mode:0o600});
      const binding=createHash('sha256').update(JSON.stringify([scope,config.roomId,config.playerToken])).digest('hex');
      next=new PlayerRuntime({...config,directory:join(this.directory,binding)});
      await next.connect();
      if(epoch!==remote.epoch)throw new ClientConnectionError('CANCELLED','登录已改变，请重新打开大厅。');
      this.runtime=next;
      if(!this.window||this.window.isDestroyed()){
        this.window=new BrowserWindow({title:'Coop Bench · 人类玩家',width:1200,height:820,minWidth:950,minHeight:650,show:false,autoHideMenuBar:true,
          webPreferences:{preload:this.preload,sandbox:true,contextIsolation:true,nodeIntegration:false,...(this.show?{}:{backgroundThrottling:false})}});
        this.window.webContents.setWindowOpenHandler(()=>({action:'deny'}));
        this.window.webContents.on('will-navigate',event=>event.preventDefault());
        this.window.webContents.on('will-redirect',event=>event.preventDefault());
        this.window.webContents.on('will-attach-webview',event=>event.preventDefault());
        this.window.on('closed',()=>{this.window=null;void this.stop();});
        await this.window.loadURL('coop://app/player.html');
      }
      const send=warning=>{if(!this.window?.isDestroyed())this.window?.webContents.send('player:state',{...this.snapshot(),...(warning?{warning}:{})});};
      next.on('state',()=>send());for(const event of ['trace-warning','agent-warning','connection-warning'])next.on(event,send);
      // Joining is the human's ready consent. Reconfirm only this seat when the
      // server publishes a new complete roster; the server still enforces CAS.
      let readyBusy=false;
      next.on('state',()=>{
        const room=next.room,me=room?.members.find(member=>member.playerId===room.playerId);
        if(readyBusy||this.runtime!==next||room?.status!=='waiting'||room.members.length!==room.playerCount||!me||me.ready)return;
        readyBusy=true;void next.ready(true).catch(error=>{if(error.code!=='STALE_ROSTER')send(this.error(error.code));}).finally(()=>{readyBusy=false;});
      });
      send();next.run().catch(()=>{});
      if(this.show){this.window.show();this.window.focus();}
      return {opened:true};
    } catch(error){await next?.close();this.runtime=null;throw error;}
    finally {this.busy=false;}
  }
  async stop(){const current=this.runtime;this.runtime=null;await current?.close();}
  async close(){await this.stop();this.window?.close();this.credentials=null;this.scope=null;}
}
