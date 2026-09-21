/* Account discovery and seat credentials stay separate from the player window. */
(()=>{
 const home=node('section','lobby-home');home.id='lobby-home';
 const heading=node('header','home-heading');heading.append(node('p','eyebrow','COOP BENCH'),node('h1','','游戏大厅'),node('p','muted','找一个房间，开始合作。也可以随时回看正在进行或已结束的对局。'));
 const blocks=node('div','home-blocks'),rooms=node('section','home-block rooms-block'),replays=node('section','home-block replay-block');replays.id='home-replays';
 const roomHeading=node('div','section-heading');roomHeading.append(node('h2','','可加入的房间'));
 const refresh=node('button','button subtle','刷新');refresh.id='refresh-lobby';refresh.type='button';roomHeading.append(refresh);
 const controls=node('div','lobby-controls'),resume=node('button','button subtle','返回我的对局'),manage=node('button','button subtle','管理房间');resume.id='resume-player';resume.type='button';manage.id='manage-rooms';manage.type='button';manage.onclick=()=>{$('create-dialog').showModal();$('list-rooms').click();};controls.append(resume,manage);
 const status=node('p','small muted');status.id='lobby-status';status.setAttribute('role','status');
 const list=node('div','lobby-rooms');list.id='joinable-rooms';rooms.append(roomHeading,status,list,controls);blocks.append(rooms,replays);home.append(heading,blocks);document.querySelector('.workspace').prepend(home);
 const box=node('dialog','audit-dialog seat-dialog');box.id='join-dialog';
 const header=node('header','drawer-heading'),title=node('h2','','加入房间'),close=node('button','icon-button','×');close.type='button';close.setAttribute('aria-label','关闭');close.onclick=()=>box.close();header.append(title,close);
 const form=node('form','drawer-content'),intro=node('p','muted','输入你的名字和 seat token，确认后坐入席位。');
 const nameLabel=node('label','','玩家名字'),name=node('input');name.id='lobby-player-name';name.maxLength=60;name.required=true;name.value='玩家';nameLabel.append(name);
 const tokenLabel=node('label','','Seat token'),token=node('input');token.id='lobby-seat-token';token.type='password';token.required=true;token.minLength=43;token.maxLength=128;token.pattern='[A-Za-z0-9_-]{43,128}';token.autocomplete='off';token.placeholder='输入你的席位密钥';tokenLabel.append(token);
 const hint=node('p','small muted','Seat token 由房主单独发给你。返回原席位时请使用同一密钥。');
 const joinStatus=node('p','small');joinStatus.id='join-status';joinStatus.setAttribute('role','status');
 const submit=node('button','button primary full','确认入席');submit.id='join-seat';submit.type='submit';form.append(intro,nameLabel,tokenLabel,hint,joinStatus,submit);box.append(header,form);document.body.append(box);
 let serial=0,loading=false,joining=false,selectedRoom=null;
 const issue=error=>error.status===404?'当前服务器尚未提供大厅功能，请更新服务端后重试。':error.message;
 function reset(){serial++;loading=false;joining=false;selectedRoom=null;list.replaceChildren();status.textContent='';token.value='';box.close();document.body.dataset.view='login';}
 function showHome(){if(!state.token)return;stopPlayback();detailController?.abort();clearInterval(detailTimer);state.detailRequest++;document.body.dataset.audit='false';document.body.dataset.view='home';$('detail').hidden=true;$('replay-loading').hidden=true;history.replaceState(null,'',location.pathname);manage.hidden=state.identity?.role==='auditor';void load();}
 function choose(room){selectedRoom=room;title.textContent=room.name||'加入房间';token.value='';token.type='password';joinStatus.textContent='';if(!box.open)box.showModal();name.focus();}
 async function openPlayer(input){
  if(joining)return;if(!transport.openPlayer){joinStatus.textContent='请使用更新后的桌面客户端加入房间。';return;}
  joining=true;token.value='';const session=state.session;joinStatus.textContent='正在连接席位…';renderBusy();
  try{await transport.openPlayer(input);if(session===state.session){token.value='';box.close();message('已入席。房间人齐后，房主即可开始游戏。');void load();}}
  catch(error){if(session===state.session){if(box.open)joinStatus.textContent=issue(error);else status.textContent=issue(error);if(error.status===404&&apiUrl==='https://coop.neutrinophysics.cn:34935/api/v1'){const switchServer=node('button','button primary','登录新版大厅');switchServer.type='button';switchServer.onclick=async()=>{await disconnect();$('api-address').value='https://coop.neutrinophysics.cn:34936/api/v1';$('login-password').focus();};list.append(node('p','muted','当前连接旧版服务。新版大厅使用 34936 端口，旧对局仍保留在原服务。'),switchServer);}}}
  finally{if(session===state.session){joining=false;renderBusy();}}
 }
 form.onsubmit=event=>{event.preventDefault();if(selectedRoom&&form.reportValidity())void openPlayer({roomId:selectedRoom.roomId,name:name.value.trim(),seatToken:token.value});};
 box.addEventListener('close',()=>{token.value='';token.type='password';});
 function renderBusy(){refresh.disabled=loading;resume.disabled=joining;submit.disabled=joining;for(const button of list.querySelectorAll('button'))button.disabled=joining;}
 async function load(){
  if(loading||!state.token)return;loading=true;const session=state.session,version=++serial;renderBusy();
  try{
   const result=await request('/lobby');if(version!==serial||session!==state.session)return;
   if(!Array.isArray(result.rooms))throw Error('大厅响应无效，请更新服务端后重试。');
   list.replaceChildren();status.textContent=`${result.rooms.length} 个可加入房间 · 自动刷新`;
   if(!result.rooms.length){const empty=node('div','home-empty');empty.append(node('strong','','还没有等待加入的房间'),node('p','','点击顶部「创建新房间」，邀请大家一起玩。'));list.append(empty);}
   for(const room of result.rooms){
    const game=state.games.find(g=>g.id===room.gameId),scenario=game?.scenarios.find(s=>s.id===room.scenarioId);
    const card=node('button','lobby-room');card.type='button';card.dataset.roomId=room.roomId;card.onclick=()=>choose(room);
    const row=node('div','section-heading');row.append(node('h3','',room.name||game?.name||room.gameId),node('span','badge active',`${room.members.length} / ${room.playerCount} 人`));
    card.append(row,node('p','small muted',`${game?.name??room.gameId} · ${scenario?.name??room.scenarioId}`),node('p','room-members',room.members.map(p=>p.name).join('、')||'等待第一位玩家'),node('span','room-join-label','加入房间 →'));list.append(card);
   }
  }catch(error){if(version===serial&&session===state.session){list.replaceChildren();status.textContent=issue(error);if(error.status===404&&apiUrl==='https://coop.neutrinophysics.cn:34935/api/v1'){const switchServer=node('button','button primary','登录新版大厅');switchServer.type='button';switchServer.onclick=async()=>{await disconnect();$('api-address').value='https://coop.neutrinophysics.cn:34936/api/v1';$('login-password').focus();};list.append(node('p','muted','当前连接旧版服务。新版大厅使用 34936 端口，旧对局仍保留在原服务。'),switchServer);}}}
  finally{if(version===serial){loading=false;renderBusy();}}
 }
 refresh.onclick=()=>void load();resume.onclick=()=>void openPlayer({});
 window.CoopLobby={home:showHome,open:showHome,join:choose,refresh:load,clear:reset};
 setInterval(()=>{if(state.token&&document.body.dataset.view==='home'&&!document.hidden&&!joining)void load();},5000);
})();
