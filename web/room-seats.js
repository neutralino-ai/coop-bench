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
   if(room.status==='active'&&member)button('token','复制 seat token',async()=>{const {seatToken}=await key(playerId);await transport.copyText(seatToken);message(`已复制席位 ${i+1} 的现有凭证。`);});
   card.append(actions);grid.append(card);
  }
  panel.append(grid);
  if(transport.hostSeat)void transport.hostSeat('status',{roomId:room.roomId}).then(statuses=>{for(const s of statuses){const card=grid.querySelector(`[data-player-id="${s.playerId}"]`);if(card){const label=({'waiting':room.status==='waiting'?'等待开局':'等待其他玩家','your-turn':'准备决策','thinking':'正在请求模型','requesting':'正在请求模型','submitting':'正在提交动作','reconnecting':'正在重连','failed':'模型调用失败','agent-error':'模型调用失败','error':'运行失败','stopped':'已停止','ended':'对局已结束'})[s.status]??'连接中';const elapsed=s.requestStartedAt&&['thinking','requesting'].includes(s.status)?` · ${Math.max(0,Math.floor((Date.now()-s.requestStartedAt)/1000))} 秒`:'';const note=node('p','small host-agent-status',`内置 Agent · ${label}${elapsed}${s.warning?'\n'+s.warning:''}`);note.setAttribute('role','status');card.append(note);if(s.canResume&&['failed','agent-error','error','stopped','reconnecting','access-denied'].includes(s.status)&&['waiting','active'].includes(room.status)){const recover=node('button','button subtle','恢复 Agent');recover.type='button';recover.dataset.action='resume-agent';recover.onclick=()=>this.modelDialog({roomId:room.roomId,playerId:s.playerId,resume:true,onStarted:async()=>{await refresh(undefined,session);message('Agent 已从原席位和上下文恢复。');}});card.append(recover);}}}}).catch(()=>{});
 },
 prompt({apiUrl,roomId,playerId,seatToken}){
  const guide=new URL('/player.md',apiUrl).href;
  return `你是 Coop Bench 的一名参赛玩家，请亲自使用现有 HTTP 工具或终端 curl 加入并持续完成这场游戏。你不是房主，不要创建房间或调用管理/审计接口。

API base: ${apiUrl}
roomId: ${roomId}
playerId: ${playerId}
seat token: ${seatToken}
玩家专用说明文档：${guide}

先 GET 并完整阅读上面的玩家文档，再执行入席、准备、等待开局和 rules → wait → actions 循环。每次提交动作必须附 decisionSummary，用中文简短说明理由（1–1200 字，仅根据本席可见信息，不要求隐藏思维过程）。首次入席 POST ${apiUrl}/rooms/${roomId}/join，Authorization: Bearer 使用上面的 seat token，JSON 为 {"name":"Claude","playerToken":"${seatToken}"}。不需要邀请码，也不需要房主密码。

新房间默认每个必需行动窗口 3 分钟，房主可自定义；以 observation.control.decisionTimeoutSeconds 和 deadlineAt 为准。timeoutPolicy=default-action-v1 或 default-action-v2 时，超时由服务器执行本席 control.timeoutAction 所示的默认合法动作并继续，不会仅因该次超时结束整局（v2 花火能弃牌时弃第一张，否则出第一张；旧 v1 策略按服务端返回）。旧对局保留原策略。等待、重连和无效动作不会续时。超时后重新 wait 读取当前观察，不要重发过期动作；整局上限和游戏自带时钟仍适用。

seat token 是私密凭证，只用于你自己的请求认证，不放进网址、公开输出或上传轨迹。只读取服务 API 的规则与本席可见信息，不搜索外部规则，不读取队友信息。准备后保持运行，等房主开始；不要回复“准备好了”就结束。规则缺失或认证失败时报告问题，不猜测或绕过。保存真实可见请求、响应与决策记录；不要编造隐藏 thinking。`;
 },
 async modelDialog({roomId,playerId,onStarted,resume=false}){
  const old=document.getElementById('host-agent-dialog');old?.remove();
  const dialog=document.createElement('dialog');dialog.id='host-agent-dialog';dialog.className='host-agent-dialog';
  dialog.innerHTML='<form id="host-agent-form"><h2>启用内置 Agent</h2><p class="muted">先测试模型，成功后加入席位。客户端需要保持打开。</p><label>模型 API 地址<input id="host-agent-url" type="url" required value="https://api.deepseek.com"></label><label>模型名称<input id="host-agent-model" required maxlength="200" value="deepseek-flash"></label><label>API key<input id="host-agent-key" type="password" required autocomplete="off"></label><label><input id="host-agent-remember" type="checkbox" checked> 加密保存 API key，下次免输入</label><button type="button" class="button subtle" id="host-agent-forget" hidden>清除已保存的密钥</button><p class="small muted">使用 Responses API。测试会进行两次简短的工具调用，可能产生少量模型费用。游戏中实际模型请求和响应会保存到本席轨迹。</p><p id="host-agent-error" role="status"></p><div class="buttons"><button type="button" class="button subtle" id="host-agent-cancel">取消</button><button type="button" class="button subtle" id="host-agent-test">测试连接与工具调用</button><button type="submit" class="button primary" id="host-agent-start" disabled>加入席位</button></div></form>';
  document.body.append(dialog);const $=id=>dialog.querySelector('#'+id),transport=window.coopTransport;
  if(resume){dialog.querySelector('h2').textContent='恢复 Agent';dialog.querySelector('p').textContent='验证模型后，继续原席位和本设备保存的上下文。';$('host-agent-start').textContent='确认恢复';}
  let verified=null,savedUrl='',hasSaved=false,busy=false,editVersion=0;
  const invalidate=()=>{editVersion++;verified=null;$('host-agent-start').disabled=true;$('host-agent-error').textContent='';$('host-agent-key').required=!(hasSaved&&$('host-agent-url').value.trim().replace(/\/$/,'')===savedUrl);};
  for(const id of ['host-agent-url','host-agent-model','host-agent-key','host-agent-remember'])$(id).oninput=invalidate;
  const lock=value=>{busy=value;for(const id of ['host-agent-url','host-agent-model','host-agent-key','host-agent-remember','host-agent-test','host-agent-forget'])$(id).disabled=value;};
  $('host-agent-cancel').onclick=()=>dialog.close();dialog.addEventListener('close',()=>{ $('host-agent-key').value='';void transport.hostSeat('cancelModelTest',{}).catch(()=>{});dialog.remove();});
  $('host-agent-test').onclick=async()=>{
   if(busy||!$('host-agent-form').reportValidity())return;verified=null;$('host-agent-start').disabled=true;lock(true);$('host-agent-error').textContent='正在验证连接和连续工具调用（最多 60 秒）…';
   const baseUrl=$('host-agent-url').value.trim(),model=$('host-agent-model').value.trim(),apiKey=$('host-agent-key').value,rememberKey=$('host-agent-remember').checked;
   try{const result=await transport.hostSeat('testModel',{baseUrl,model,apiKey,rememberKey});if(!dialog.isConnected)return;verified=result.verificationId;$('host-agent-key').required=false;if(result.keySaved){savedUrl=baseUrl.replace(/\/$/,'');hasSaved=true;$('host-agent-forget').hidden=false;$('host-agent-key').placeholder='已加密保存；留空使用已保存密钥';$('host-agent-key').required=false;}$('host-agent-key').value='';$('host-agent-error').textContent='连接和连续工具调用通过，可以加入席位。';$('host-agent-start').disabled=false;}
   catch(error){if(dialog.isConnected){$('host-agent-key').value='';$('host-agent-error').textContent=error.message;}}
   finally{if(dialog.isConnected)lock(false);}
  };
  $('host-agent-forget').onclick=async()=>{await transport.hostSeat('forgetModel',{});hasSaved=false;savedUrl='';$('host-agent-key').value='';$('host-agent-key').placeholder='';$('host-agent-forget').hidden=true;invalidate();$('host-agent-error').textContent='已清除本地保存的密钥。';};
  $('host-agent-form').onsubmit=async event=>{event.preventDefault();if(busy||!verified||$('host-agent-start').disabled)return;$('host-agent-start').disabled=true;lock(true);
   try{await transport.hostSeat(resume?'resume':'start',{roomId,playerId,verificationId:verified});dialog.close();await onStarted();}
   catch(error){if(dialog.isConnected){verified=null;$('host-agent-error').textContent=error.message;lock(false);}}
  };dialog.showModal();lock(true);$('host-agent-error').textContent='正在读取模型配置…';
  const version=editVersion;
  try{const config=await transport.hostSeat('modelConfig',{});if(!dialog.isConnected||editVersion!==version)return;$('host-agent-url').value=config.baseUrl;$('host-agent-model').value=config.model;hasSaved=config.hasApiKey;savedUrl=config.baseUrl;$('host-agent-key').required=!hasSaved;$('host-agent-key').placeholder=hasSaved?'已加密保存；留空使用已保存密钥':'';$('host-agent-forget').hidden=!hasSaved;$('host-agent-remember').checked=config.canRememberKey;$('host-agent-error').textContent=config.canRememberKey?'':'系统加密暂不可用，本次仅在内存使用密钥。';}catch(error){if(dialog.isConnected)$('host-agent-error').textContent=error.message;}finally{dialog.dataset.loaded='true';if(dialog.isConnected)lock(false);}
 }
};
