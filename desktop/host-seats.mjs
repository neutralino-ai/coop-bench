import {createHash,randomUUID} from 'node:crypto';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {join} from 'node:path';

// The supervisor owns account access. Each runtime receives only one seat and
// its provider configuration; it never receives this supervisor or RemoteSession.
export class HostSeats {
  agents=new Map();keys=new Map();pending=new Set();generation=0;
  constructor({remote,directory,encryption,Runtime,Agent}){Object.assign(this,{remote,directory,encryption,Runtime,Agent});mkdirSync(directory,{recursive:true});}
  scope(){if(!this.remote.token||this.remote.identity?.role!=='operator')throw Error('请使用房主账号登录。');return createHash('sha256').update(JSON.stringify([this.remote.apiUrl,this.remote.identity.id])).digest('hex');}
  file(){return join(this.directory,this.scope()+'.encrypted');}
  load(){const scope=this.scope();if(this.loaded===scope)return;this.keys.clear();this.loaded=scope;try{if(this.encryption.isEncryptionAvailable())this.keys=new Map(JSON.parse(this.encryption.decryptString(readFileSync(this.file()))));}catch{}}
  save(){if(this.encryption.isEncryptionAvailable())writeFileSync(this.file(),this.encryption.encryptString(JSON.stringify([...this.keys])),{mode:0o600});}
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
    const {roomId,playerId,baseUrl,model,apiKey}=input,id=roomId+'/'+playerId,scope=this.scope(),generation=this.generation,epoch=this.remote.epoch;
    if(this.agents.has(id)||this.pending.has(id))throw Error('这个席位已有内置 Agent。');
    const agent=new this.Agent({baseUrl,model,apiKey});this.pending.add(id);let runtime;
    try{
      const {seatToken}=await this.key({roomId,playerId});
      if(generation!==this.generation||epoch!==this.remote.epoch)throw Error('登录已改变，请重试。');
      const binding=createHash('sha256').update(scope+id+seatToken).digest('hex');
      runtime=new this.Runtime({apiUrl:this.remote.apiUrl,roomId,playerToken:seatToken,name:`AI · ${model}`.slice(0,60),directory:join(this.directory,binding)});
      runtime.attachAgent(agent);await runtime.connect();
      if(generation!==this.generation||epoch!==this.remote.epoch)throw Error('登录已改变，请重试。');
      const entry={runtime,playerId,roomId,status:'waiting',warning:null};this.agents.set(id,entry);let readyBusy=false;
      runtime.on('state',snapshot=>{
        entry.status=snapshot.status;const room=snapshot.room,me=room?.members.find(m=>m.playerId===room.playerId);
        if(!readyBusy&&this.agents.get(id)===entry&&room?.status==='waiting'&&room.members.length===room.playerCount&&me&&!me.ready){readyBusy=true;runtime.ready().catch(()=>{}).finally(()=>{readyBusy=false;});}
      });
      for(const event of ['agent-warning','connection-warning','trace-warning'])runtime.on(event,()=>{entry.warning=event==='agent-warning'?'模型调用失败，请检查模型配置。':event==='trace-warning'?'记录上传等待重试。':'连接等待恢复。';});
      runtime.run().catch(()=>{entry.status='error';}).finally(()=>{if(['access-denied','room-closed','ended'].includes(entry.status))void this.stop(id);});
      return {started:true,playerId};
    }catch(error){await runtime?.close();throw error;}finally{this.pending.delete(id);}
  }
  status({roomId}){this.scope();return [...this.agents.values()].filter(a=>a.roomId===roomId).map(({playerId,status,warning})=>({playerId,status,warning}));}
  async stop(id){const entry=this.agents.get(id);this.agents.delete(id);await entry?.runtime.close();}
  async close(){this.generation++;await Promise.all([...this.agents.keys()].map(id=>this.stop(id)));this.keys.clear();this.loaded=null;}
}
