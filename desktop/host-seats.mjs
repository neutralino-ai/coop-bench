import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync,existsSync,unlinkSync,statSync} from 'node:fs';
import {join} from 'node:path';
import {ClientConnectionError} from './remote-session.mjs';

function modelWarning(code){
  if(!code)return null;
  const status=/^MODEL_API_HTTP_(\d{3})$/.exec(code)?.[1];
  if(status)return `模型调用失败（HTTP ${status}）：${status==='401'||status==='403'?'请检查 API key 与模型权限。':status==='429'?'模型服务限流或额度不足。':Number(status)>=500?'模型服务暂时不可用。':'请检查模型名称、地址及接口参数兼容性。'}`;
  return ({MODEL_NETWORK_ERROR:'无法连接模型服务，请检查网络和模型 API 地址。',MODEL_CANCELLED:'模型调用已取消。',MODEL_TIMEOUT:'模型响应超时。',MODEL_TOOL_FORMAT:'模型未返回有效的工具调用。',MODEL_INCOMPLETE:'模型输出未完成，无法执行动作。',MODEL_INVALID_RESPONSE:'模型服务返回了无法解析的响应。',MODEL_RESPONSE_TOO_LARGE:'模型响应超过大小限制。'})[code]??'内置 Agent 行动失败，请查看本局调用记录。';
}

// The supervisor owns account access. Each runtime receives only one seat and
// its provider configuration; it never receives this supervisor or RemoteSession.
export class HostSeats {
  agents=new Map();keys=new Map();pending=new Set();verified=new Map();generation=0;probe=null;
  constructor({remote,directory,encryption,Runtime,Agent}){Object.assign(this,{remote,directory,encryption,Runtime,Agent});mkdirSync(directory,{recursive:true});}
  scope(){if(!this.remote.token||this.remote.identity?.role!=='operator')throw Error('请使用房主账号登录。');return createHash('sha256').update(JSON.stringify([this.remote.apiUrl,this.remote.identity.id])).digest('hex');}
  file(){return join(this.directory,this.scope()+'.encrypted');}
  load(){const scope=this.scope();if(this.loaded===scope)return;this.keys.clear();this.loaded=scope;try{if(this.encryption.isEncryptionAvailable())this.keys=new Map(JSON.parse(this.encryption.decryptString(readFileSync(this.file()))));}catch{}}
  save(){if(this.encryption.isEncryptionAvailable())writeFileSync(this.file(),this.encryption.encryptString(JSON.stringify([...this.keys])),{mode:0o600});}
  modelFile(){return join(this.directory,this.scope()+'.model.encrypted');}
  savedModel(){
    try{const file=this.modelFile();if(!this.encryption.isEncryptionAvailable()||statSync(file).size>16384)return null;
      const value=JSON.parse(this.encryption.decryptString(readFileSync(file)));return value.scope===this.scope()?value.config:null;
    }catch{return null;}
  }
  modelConfig(){this.scope();const saved=this.savedModel();return {baseUrl:saved?.baseUrl??'https://api.deepseek.com',model:saved?.model??'deepseek-flash',hasApiKey:Boolean(saved?.apiKey),canRememberKey:this.encryption.isEncryptionAvailable()};}
  forgetModel(){const file=this.modelFile();if(existsSync(file))unlinkSync(file);this.cancelModelTest();this.verified.clear();return {forgotten:true};}
  cancelModelTest(){this.probe?.abort();this.probe=null;return {cancelled:true};}
  async testModel(input){
    const scope=this.scope(),generation=this.generation,epoch=this.remote.epoch;
    this.cancelModelTest();const controller=new AbortController();this.probe=controller;
    try{
      let baseUrl;try{baseUrl=new URL(input.baseUrl).href.replace(/\/$/,'');}catch{throw new ClientConnectionError('MODEL_CONFIG','请输入有效的模型 API 地址。');}
      const saved=this.savedModel(),apiKey=input.apiKey||((saved?.baseUrl===baseUrl)?saved.apiKey:'');
      if(!apiKey)throw new ClientConnectionError('MODEL_CONFIG','请输入此模型 API 地址对应的 API key。');
      const config={baseUrl,model:input.model,apiKey,api:'responses'};
      let agent;try{agent=new this.Agent(config);}catch{throw new ClientConnectionError('MODEL_CONFIG','请检查模型地址、名称与 API key；远程地址需使用 HTTPS。');}
      await agent.testConnection({signal:controller.signal});
      if(controller.signal.aborted||generation!==this.generation||epoch!==this.remote.epoch)throw new ClientConnectionError('MODEL_CANCELLED','测试已取消，请重新测试。');
      if(input.rememberKey!==false){
        if(!this.encryption.isEncryptionAvailable())throw new ClientConnectionError('MODEL_STORAGE','系统加密不可用，请取消保存密钥后重试。');
        writeFileSync(this.modelFile(),this.encryption.encryptString(JSON.stringify({scope,config})),{mode:0o600});
      }
      const verificationId=randomUUID();this.verified.clear();this.verified.set(verificationId,{agent,config,scope,epoch,expires:Date.now()+300000});
      return {ok:true,verificationId,keySaved:input.rememberKey!==false};
    }catch(error){throw error instanceof ClientConnectionError?error:new ClientConnectionError('MODEL_TEST_FAILED',modelWarning(error.code));}
    finally{if(this.probe===controller)this.probe=null;}
  }
  async request(path,body){const r=await this.remote.request({id:randomUUID(),path:'/api/v1'+path,method:body===undefined?'GET':'POST',...(body===undefined?{}:{body})});const value=JSON.parse(Buffer.from(r.bytes).toString());if(r.status>=400)throw Error(({ROOM_FULL:'席位已有人加入，请刷新房间。',ROOM_CLOSED:'房间已开始或已过期。'})[value.error?.code]??'房间操作未完成，请刷新后重试。');return value;}
  async capture(input,response){
    if(response.status>=400||input.method!=='POST')return;
    const path=input.path?.replace(/^\/api\/v1/,'');
    if(path!=='/rooms'&&!/^\/rooms\/[^/]+\/admin-(seat-tokens|kick)$/.test(path??''))return;
    this.load();const value=JSON.parse(Buffer.from(response.bytes).toString());
    for(const seat of value.seatTokens??[])this.keys.set(value.roomId+'/'+seat.playerId,seat.seatToken);
    if(path.endsWith('/admin-kick')){const id=value.roomId+'/'+input.body.playerId;this.keys.delete(id);await this.stop(id);}
    this.save();
  }
  async key({roomId,playerId}){
    this.load();if(!/^[a-f0-9-]{36}$/.test(roomId??'')||!/^p[1-9]\d*$/.test(playerId??''))throw Error('无效房间或席位。');
    const room=await this.request(`/rooms/${roomId}/admin`);
    if(room.status!=='waiting'||!room.allowHumans||Number(playerId.slice(1))>room.playerCount||room.members.some(m=>m.playerId===playerId))throw Error('这个席位已经有人加入，或房间已关闭。');
    const id=roomId+'/'+playerId;
    if(!this.keys.has(id)){const issued=await this.request(`/rooms/${roomId}/admin-seat-tokens`,{playerId});for(const seat of issued.seatTokens)this.keys.set(roomId+'/'+seat.playerId,seat.seatToken);this.save();}
    return {seatToken:this.keys.get(id)};
  }
  async start(input){
    const {roomId,playerId}=input,id=roomId+'/'+playerId,scope=this.scope(),generation=this.generation,epoch=this.remote.epoch;
    if(this.agents.has(id)||this.pending.has(id))throw Error('这个席位已有内置 Agent。');
    const verified=this.verified.get(input.verificationId);
    if(!verified||verified.scope!==scope||verified.epoch!==epoch||verified.expires<Date.now())throw new ClientConnectionError('MODEL_TEST_REQUIRED','请先测试模型连接与工具调用，再加入席位。');
    this.verified.delete(input.verificationId);const {agent,config:{model}}=verified;this.pending.add(id);let runtime;
    try{
      const {seatToken}=await this.key({roomId,playerId});
      if(generation!==this.generation||epoch!==this.remote.epoch)throw Error('登录已改变，请重试。');
      const binding=createHash('sha256').update(scope+id+seatToken).digest('hex');
      runtime=new this.Runtime({apiUrl:this.remote.apiUrl,roomId,playerToken:seatToken,name:`AI · ${model}`.slice(0,60),directory:join(this.directory,binding)});
      runtime.attachAgent(agent);await runtime.connect();
      if(generation!==this.generation||epoch!==this.remote.epoch)throw Error('登录已改变，请重试。');
      const entry={runtime,playerId,roomId,status:'waiting',warning:null};this.agents.set(id,entry);let readyBusy=false;
      runtime.on('state',snapshot=>{
        entry.status=entry.stopped&&snapshot.observation?.status==='active'?'agent-error':snapshot.status;const room=snapshot.room,me=room?.members.find(m=>m.playerId===room.playerId);
        if(!readyBusy&&this.agents.get(id)===entry&&room?.status==='waiting'&&room.members.length===room.playerCount&&me&&!me.ready){readyBusy=true;runtime.ready().catch(()=>{}).finally(()=>{readyBusy=false;});}
      });
      runtime.on('agent-warning',code=>{entry.warning=modelWarning(code);});
      runtime.on('agent-stopped',code=>{entry.stopped=true;entry.status='agent-error';entry.warning=modelWarning(code)+' 已停止自动调用，回合时限仍继续。';});
      runtime.on('agent-success',()=>{entry.warning=null;});
      for(const event of ['connection-warning','trace-warning'])runtime.on(event,()=>{if(!entry.warning)entry.warning=event==='trace-warning'?'记录上传等待重试。':'连接等待恢复。';});
      runtime.run().catch(()=>{entry.status='error';}).finally(()=>{if(['access-denied','room-closed','ended'].includes(entry.status))void this.stop(id);});
      return {started:true,playerId};
    }catch(error){await runtime?.close();throw error;}finally{this.pending.delete(id);}
  }
  status({roomId}){this.scope();return [...this.agents.values()].filter(a=>a.roomId===roomId).map(({playerId,status,warning})=>({playerId,status,warning}));}
  async stop(id){const entry=this.agents.get(id);this.agents.delete(id);await entry?.runtime.close();}
  async close(){this.generation++;this.cancelModelTest();this.verified.clear();await Promise.all([...this.agents.keys()].map(id=>this.stop(id)));this.keys.clear();this.loaded=null;}
}
