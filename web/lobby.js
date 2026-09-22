/* Account discovery and seat credentials stay separate from the player window. */
(()=>{
 const home=node('section','lobby-home');home.id='lobby-home';
 const heading=node('header','home-heading');heading.append(node('p','eyebrow','COOP BENCH'),node('h1','','游戏大厅'),node('p','muted','找一个房间，开始合作。也可以随时回看正在进行或已结束的对局。'));
 const blocks=node('div','home-blocks'),rooms=node('section','home-block rooms-block'),replays=node('section','home-block replay-block');replays.id='home-replays';
 const roomHeading=node('div','section-heading');roomHeading.append(node('h2','','可加入的房间'));
 const refresh=node('button','button subtle','刷新');refresh.id='refresh-lobby';refresh.type='button';roomHeading.append(refresh);
 const controls=node('div','lobby-controls');
 const status=node('p','small muted');status.id='lobby-status';status.setAttribute('role','status');
 const list=node('div','lobby-rooms');list.id='joinable-rooms';rooms.append(roomHeading,status,list,controls);blocks.append(rooms,replays);home.append(heading,blocks);document.querySelector('.workspace').prepend(home);
 const personal=node('div','home-blocks personal-rooms'),created=node('section','home-block'),participating=node('section','home-block'),createdList=node('div','lobby-rooms'),participatingList=node('div','lobby-rooms');
 createdList.id='my-created-rooms';participatingList.id='my-participating-rooms';created.append(node('h2','','我创建的'),createdList);participating.append(node('h2','','我参与的'),participatingList);personal.append(created,participating);heading.after(personal);
 const box=node('dialog','audit-dialog seat-dialog');box.id='join-dialog';
 const header=node('header','drawer-heading'),title=node('h2','','加入房间'),close=node('button','icon-button','×');close.type='button';close.setAttribute('aria-label','关闭');close.onclick=()=>box.close();header.append(title,close);
 const form=node('form','drawer-content'),intro=node('p','muted','输入你的名字和 seat token，确认后坐入席位。');
 const nameLabel=node('label','','玩家名字'),name=node('input');name.id='lobby-player-name';name.maxLength=60;name.required=true;name.value='玩家';nameLabel.append(name);
 const tokenLabel=node('label','','Seat token'),token=node('input');token.id='lobby-seat-token';token.type='password';token.required=true;token.minLength=43;token.maxLength=128;token.pattern='[A-Za-z0-9_-]{43,128}';token.autocomplete='off';token.placeholder='输入你的席位密钥';tokenLabel.append(token);
 const hint=node('p','small muted','首次入席需要房主发放的 seat token。以后在“我参与的”直接继续。');
 const joinStatus=node('p','small');joinStatus.id='join-status';joinStatus.setAttribute('role','status');
 const submit=node('button','button primary full','确认入席');submit.id='join-seat';submit.type='submit';const roomLabel=node('label','','房间 ID'),roomInput=node('input');roomInput.id='lobby-room-id';roomInput.required=true;roomInput.pattern='[a-f0-9-]{36}';roomLabel.append(roomInput);form.append(intro,roomLabel,nameLabel,tokenLabel,hint,joinStatus,submit);box.append(header,form);document.body.append(box);
 let serial=0,loading=false,joining=false,selectedRoom=null;
 const issue=error=>error.status===404?'当前服务器尚未提供大厅功能，请更新服务端后重试。':error.message;
 function reset(){serial++;loading=false;joining=false;selectedRoom=null;list.replaceChildren();createdList.replaceChildren();participatingList.replaceChildren();status.textContent='';token.value='';box.close();document.body.dataset.view='login';}
 function showHome(){if(!state.token)return;message('');stopPlayback();detailController?.abort();clearInterval(detailTimer);state.detailRequest++;document.body.dataset.audit='false';document.body.dataset.view='home';$('detail').hidden=true;$('replay-loading').hidden=true;history.replaceState(null,'',location.pathname);void load();if(incoming&&incoming.apiUrl===apiUrl){choose(incoming);incoming=null;}}
 function choose(room){selectedRoom=room;title.textContent=room.name||'加入房间';roomInput.value=room.roomId??'';token.value='';token.type='password';joinStatus.textContent='';if(!box.open)box.showModal();name.focus();}
 async function openPlayer(input){
  if(joining)return;if(!transport.openPlayer){joinStatus.textContent='请使用更新后的桌面客户端加入房间。';return;}
  joining=true;token.value='';const session=state.session;joinStatus.textContent='正在连接席位…';renderBusy();
  try{await transport.openPlayer(input);if(session===state.session){token.value='';box.close();message('已入席。房间人齐后，房主即可开始游戏。');void load();}}
  catch(error){if(session===state.session){if(box.open)joinStatus.textContent=issue(error);else status.textContent=issue(error);if(error.status===404&&apiUrl==='https://coop.neutrinophysics.cn:34935/api/v1'){const switchServer=node('button','button primary','登录新版大厅');switchServer.type='button';switchServer.onclick=async()=>{await disconnect();$('api-address').value='https://coop.neutrinophysics.cn:34936/api/v1';$('login-password').focus();};list.append(node('p','muted','当前连接旧版服务。新版大厅使用 34936 端口，旧对局仍保留在原服务。'),switchServer);}}}
  finally{if(session===state.session){joining=false;renderBusy();}}
 }
 form.onsubmit=event=>{event.preventDefault();if(form.reportValidity())void openPlayer({roomId:roomInput.value.trim(),name:name.value.trim(),seatToken:token.value});};
 box.addEventListener('close',()=>{token.value='';token.type='password';});
 function renderBusy(){refresh.disabled=loading;submit.disabled=joining;for(const button of list.querySelectorAll('button'))button.disabled=joining;}
 async function load(){
  if(loading||!state.token)return;loading=true;const session=state.session,version=++serial;renderBusy();
  try{
   const [result,mine]=await Promise.all([request('/lobby'),request('/lobby/mine')]);if(version!==serial||session!==state.session)return;
   for(const [target,values,owned] of [[createdList,mine.created,true],[participatingList,mine.participating,false]]){
    const visible=(values??[]).filter(room=>!owned||['waiting','active'].includes(room.status));target.replaceChildren();if(!visible.length)target.append(node('p','muted',owned?'创建房间后，在这里管理。':'加入房间后，在这里继续。'));
    for(const room of visible){const card=node('article','lobby-room personal-room');card.dataset.roomId=room.roomId;const row=node('div','section-heading');row.append(node('h3','',room.name),node('span','badge neutral',({waiting:'等待开始',active:'进行中',completed:'已结束',truncated:'已中止',cancelled:'已取消',expired:'已过期'})[room.status]??room.status));card.append(row);
     const open=node('button','button subtle',owned?'管理房间':['waiting','active'].includes(room.status)?'继续对局':'查看回放');open.type='button';open.onclick=()=>{if(owned)void window.CoopRooms?.open(room.roomId);else if(['waiting','active'].includes(room.status))void openPlayer({roomId:room.roomId});else if(room.episodeId)void selectEpisode(room.episodeId);};if(owned){card.classList.add('owned-room');card.append(open);}else card.append(open);
     if(!owned&&room.status==='waiting'){const release=node('button','button ghost','释放席位');release.type='button';release.onclick=async()=>{release.disabled=true;try{await request(`/lobby/${room.roomId}/leave`,{});await load();}catch(error){status.textContent=issue(error);}finally{release.disabled=false;}};card.append(release);}
     target.append(card);
    }
   }
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
 const byId=node('button','button subtle','输入房间 ID 加入');byId.id='join-by-id';byId.type='button';byId.onclick=()=>choose({});controls.prepend(byId);
 let incoming=null;function acceptLink(value){try{const u=new URL(value),q=new URLSearchParams(u.hash.slice(1));if(u.protocol!=='coopbench:'||u.hostname!=='join'||!/^[a-f0-9-]{36}$/.test(q.get('room')??''))return;const target=new URL(q.get('api'));if(target.protocol!=='https:'&&!(target.protocol==='http:'&&['localhost','127.0.0.1','[::1]'].includes(target.hostname)))return;incoming={roomId:q.get('room'),apiUrl:target.origin+'/api/v1'};if(!state.token){$('api-address').value=incoming.apiUrl;message('收到房间邀请，登录后输入 seat token 入席。');}else if(incoming.apiUrl===apiUrl){choose(incoming);incoming=null;}else message('邀请属于另一个服务器，请先切换登录地址。',true);}catch{}}
 window.coopDesktop?.onInvitation?.(acceptLink);window.coopDesktop?.incomingInvitation?.().then(acceptLink);
 refresh.onclick=()=>void load();
 window.CoopLobby={home:showHome,open:showHome,join:choose,refresh:load,clear:reset};
 setInterval(()=>{if(state.token&&document.body.dataset.view==='home'&&!document.hidden&&!joining)void load();},5000);
})();
