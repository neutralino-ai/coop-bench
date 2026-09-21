/* Room management contains no player policy or private game observations. */
window.CoopRoomSeats={
 render({room,panel,apiUrl,transport,request,message,refresh,guarded,session}){
  const node=(tag,cls,text)=>{const e=document.createElement(tag);e.className=cls??'';if(text)e.textContent=text;return e;};
  const grid=node('div','host-seat-grid');
  const key=async playerId=>{if(!transport.hostSeat)throw Error('请升级桌面客户端后使用席位按钮。');return transport.hostSeat('key',{roomId:room.roomId,playerId});};
  for(let i=0;i<room.playerCount;i++){
   const playerId=`p${i+1}`,member=room.members.find(m=>m.playerId===playerId),card=node('article','host-seat '+(member?'occupied':'vacant'));card.dataset.playerId=playerId;
   const heading=node('div','section-heading');heading.append(node('h4','',`席位 ${i+1}`),node('span','badge '+(member?'active':'neutral'),member?(member.ready?'已准备':'已入席'):'空席'));card.append(heading,node('p','host-seat-name',member?.name??'等待玩家加入'));
   const actions=node('div','host-seat-actions');
   const button=(action,label,fn)=>{const b=node('button','button subtle',label);b.type='button';b.dataset.action=action;b.dataset.seat=playerId;b.onclick=guarded(async()=>{if(b.disabled)return;b.disabled=true;try{await fn();}finally{b.disabled=false;}});actions.append(b);};
   if(room.status==='waiting'){
    if(member)button('kick','踢出玩家',async()=>{const next=await request(`/rooms/${room.roomId}/admin-kick`,{playerId});await refresh(next,session);message('玩家已踢出，旧 seat token 已失效。');});
    else if(room.allowHumans){
     button('claude','复制 Claude 入席提示词',async()=>{const {seatToken}=await key(playerId);await transport.copyText(this.prompt({apiUrl,roomId:room.roomId,playerId,seatToken}));message('已复制 Claude 入席提示词，含本席密钥，请只交给这位玩家。');});
     button('agent','启用内置 Agent',async()=>this.modelDialog({roomId:room.roomId,playerId,onStarted:async()=>{await refresh(undefined,session);message('内置 Agent 已入席，客户端保持打开即可。');}}));
     button('token','复制 seat token',async()=>{const {seatToken}=await key(playerId);await transport.copyText(seatToken);message(`已复制席位 ${i+1} 的 seat token。`);});
    }
   }
   card.append(actions);grid.append(card);
  }
  panel.append(grid);
  if(transport.hostSeat)void transport.hostSeat('status',{roomId:room.roomId}).then(statuses=>{for(const s of statuses){const card=grid.querySelector(`[data-player-id="${s.playerId}"]`);if(card)card.append(node('p','small muted',s.warning??`内置 Agent · ${s.status==='waiting'?'等待开局':s.status==='reconnecting'?'正在重连':'运行中'}`));}}).catch(()=>{});
 },
 prompt({apiUrl,roomId,playerId,seatToken}){
  const guide=new URL('/player.md',apiUrl).href;
  return `你是 Coop Bench 的一名参赛玩家，请亲自使用现有 HTTP 工具或终端 curl 加入并持续完成这场游戏。你不是房主，不要创建房间或调用管理/审计接口。

API base: ${apiUrl}
roomId: ${roomId}
playerId: ${playerId}
seat token: ${seatToken}
玩家专用说明文档：${guide}

先 GET 并完整阅读上面的玩家文档，再执行入席、准备、等待开局和 rules → wait → actions 循环。首次入席 POST ${apiUrl}/rooms/${roomId}/join，Authorization: Bearer 使用上面的 seat token，JSON 为 {"name":"Claude","playerToken":"${seatToken}"}。不需要邀请码，也不需要房主密码。

seat token 是私密凭证，只用于你自己的请求认证，不放进网址、公开输出或上传轨迹。只读取服务 API 的规则与本席可见信息，不搜索外部规则，不读取队友信息。准备后保持运行，等房主开始；不要回复“准备好了”就结束。规则缺失或认证失败时报告问题，不猜测或绕过。保存真实可见请求、响应与决策记录；不要编造隐藏 thinking。`;
 },
 modelDialog({roomId,playerId,onStarted}){
  const old=document.getElementById('host-agent-dialog');old?.remove();
  const dialog=document.createElement('dialog');dialog.id='host-agent-dialog';dialog.className='host-agent-dialog';
  dialog.innerHTML='<form id="host-agent-form"><h2>启用内置 Agent</h2><p class="muted">由本机运行，使用你提供的模型 API。客户端需要保持打开。</p><label>模型 API 地址<input id="host-agent-url" type="url" required placeholder="https://provider.example/v1"></label><label>模型名称<input id="host-agent-model" required maxlength="200" placeholder="模型 ID"></label><label>API key<input id="host-agent-key" type="password" required autocomplete="off"></label><p class="small muted">兼容 Chat Completions 工具调用。密钥仅在本次进程中使用；实际模型请求和响应会记录到本席轨迹。</p><p id="host-agent-error" role="status"></p><div class="buttons"><button type="button" class="button subtle" id="host-agent-cancel">取消</button><button type="submit" class="button primary" id="host-agent-start">启用并加入席位</button></div></form>';
  document.body.append(dialog);const $=id=>dialog.querySelector('#'+id);$('host-agent-url').value=this.providerUrl??'';$('host-agent-model').value=this.providerModel??'';
  $('host-agent-cancel').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{ $('host-agent-key').value='';dialog.remove();});
  $('host-agent-form').onsubmit=async event=>{event.preventDefault();const button=$('host-agent-start');if(button.disabled)return;button.disabled=true;$('host-agent-error').textContent='';
   const baseUrl=$('host-agent-url').value.trim(),model=$('host-agent-model').value.trim(),apiKey=$('host-agent-key').value;
   try{await window.coopTransport.hostSeat('start',{roomId,playerId,baseUrl,model,apiKey});this.providerUrl=baseUrl;this.providerModel=model;dialog.close();await onStarted();}
   catch(error){if(dialog.isConnected){$('host-agent-key').value='';$('host-agent-error').textContent=error.message;button.disabled=false;}}
  };dialog.showModal();
 }
};
