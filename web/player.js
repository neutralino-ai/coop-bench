const $=id=>document.getElementById(id),api=window.coopPlayer;let state={},actionSchema,latestMode='human',busy=false,shownObservationId=null;
const names={'disconnected':'尚未连接','connecting':'连接中…','waiting':'已连接 · 等待','your-turn':'已连接 · 轮到你','thinking':'Agent 正在思考','submitting':'正在提交','reconnecting':'连接中断 · 正在重连','ended':'游戏结束','access-denied':'席位凭证被拒绝','room-closed':'房间已关闭'};
const node=(tag,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
const colorName={white:'白',red:'红',blue:'蓝',yellow:'黄',green:'绿'};
async function command(name,input){try{$('notice').textContent='';return await api.command(name,input);}catch(error){$('notice').textContent=error.message;throw error;}}
function render(next){state=next;$('status').textContent=names[next.status]??next.status;$('light').className=['access-denied','room-closed'].includes(next.status)?'red':['connecting','reconnecting','submitting'].includes(next.status)?'yellow':next.room?'green':'';
 $('join').hidden=Boolean(next.room);$('disconnect').hidden=!next.room;$('lobby').hidden=!next.room||Boolean(next.room.episodeId);$('game').hidden=!next.observation;
 if(next.warning)$('notice').textContent=next.warning;
 if(next.room){$('game-name').textContent=next.rules?.name??next.room.gameId;$('room-status').textContent=`${next.room.scenarioId} · ${next.room.members.length}/${next.room.playerCount} 人 · 成员变化后需重新准备`;
  $('members').replaceChildren();for(const p of next.room.members){const card=node('div','', 'member');card.append(node('strong',`${p.name}${p.playerId===next.room.playerId?'（我）':''}`),node('div',p.ready?'✓ 已准备':'等待准备'));
   if(next.room.playerId===next.room.hostPlayerId&&p.playerId!==next.room.playerId){const b=node('button','移出');b.onclick=()=>command('kick',{playerId:p.playerId}).catch(()=>{});card.append(b);}$('members').append(card);}
  const me=next.room.members.find(p=>p.playerId===next.room.playerId);$('ready').textContent=me?.ready?'取消准备':'准备好了';$('start').hidden=$('invite').hidden=next.room.playerId!==next.room.hostPlayerId;
  $('start').disabled=next.room.members.length!==next.room.playerCount||!next.room.members.every(p=>p.ready);
 }
 if(!next.observation)shownObservationId=null;
 if(next.observation&&next.observation.observationId!==shownObservationId){const o=next.observation;shownObservationId=o.observationId;$('phase').textContent=o.status==='active'?`${next.rules?.id==='hanabi'?'花火':next.rules?.name??'游戏'} · 我是 ${o.playerId}`:o.outcome?`结束 · ${o.outcome.score}${o.outcome.maxScore?'/'+o.outcome.maxScore:''} 分`:`已截断 · ${o.control?.endReason??''}`;
  renderBoard(o);$('observation').textContent=JSON.stringify(o,null,2);$('updates').textContent=JSON.stringify(o.updates??[],null,2);
  $('action-status').textContent=o.status!=='active'?'本局已结束。':latestMode==='model'?'模型自动决策，人工动作已禁用。':o.control?.required?'请在截止时间前提交合法动作。':'当前无需你必须行动；可选动作以游戏规则为准。';
  const old=$('action-type').value;$('action-type').replaceChildren();for(const a of o.legalActions){const option=node('option',a.type);option.value=a.type;$('action-type').append(option);}if(o.legalActions.some(a=>a.type===old))$('action-type').value=old;
  $('action-form').hidden=latestMode==='model'||!o.legalActions.length||o.status!=='active';renderAction();
 }
 $('trace').textContent=next.trace?`轨迹：已确认 ${next.trace.acknowledgedThrough+1} 条，待上传 ${next.trace.pendingMessages} 条。`:'轨迹会在开局后记录。';countdown();
}
function renderBoard(o){const board=$('board');board.replaceChildren();const v=o.view;
 if(v.fireworks&&v.hands){const metrics=node('div','','metrics');for(const text of [`提示 ${v.hints}/8`,`失误 ${v.errors}/3`,`牌堆 ${v.deckCount}`,`当前 ${v.current}`])metrics.append(node('span',text,'metric'));board.append(metrics);
  const piles=node('div','','cards');for(const [color,value]of Object.entries(v.fireworks))piles.append(node('div',`${colorName[color]??color}\n${value}`,'card '+color));board.append(piles);
  for(const [p,hand]of Object.entries(v.hands)){const section=node('section','','player-hand');section.append(node('strong',p===o.playerId?'我的手牌（只能看提示知识）':`${p} 的手牌`));const cards=node('div','','cards');for(const [i,c]of hand.entries())cards.append(node('div',c.color?`${i+1} · ${colorName[c.color]??c.color}\n${c.value??c.rank??'?'}`:`${i+1} · 未知\n${c.possibleValues?.join('·')??'?'}\n${c.possibleColors?.map(c=>colorName[c]??c).join('')??'?'}`,'card '+(c.color??'')));section.append(cards);board.append(section);}return;
 }
 for(const [key,value]of Object.entries(v)){const row=node('div','','generic-field');row.append(node('b',key),node(typeof value==='object'?'pre':'div',typeof value==='object'?JSON.stringify(value,null,2):String(value)));board.append(row);}
}
function renderAction(){const a=state.observation?.legalActions.find(a=>a.type===$('action-type').value);actionSchema=a?.schema;$('action-fields').replaceChildren();$('action-description').textContent=a?.description??'';
 for(const [name,s]of Object.entries(actionSchema?.properties??{})){if(name==='type')continue;const label=node('label',name),values=s.enum??(Object.hasOwn(s,'const')?[s.const]:s.anyOf?.every(v=>Array.isArray(v.enum))?s.anyOf.flatMap(v=>v.enum):null);let input;
  if(values||s.type==='boolean'){input=node('select');for(const value of values??[true,false]){const option=node('option',String(value));option.value=JSON.stringify(value);input.append(option);}input.dataset.json='true';}
  else {input=node(s.type==='array'||s.type==='object'?'textarea':'input');if(s.type==='integer'||s.type==='number'){input.type='number';input.min=s.minimum??'';input.max=s.maximum??'';input.step=s.type==='integer'?'1':'any';input.dataset.number='true';}if(s.type==='array'||s.type==='object'){input.value=s.type==='array'?'[]':'{}';input.dataset.json='true';}if(s.maxLength)input.maxLength=s.maxLength;}
  input.name=name;input.required=(actionSchema.required??[]).includes(name);label.append(input);$('action-fields').append(label);
 }
}
function countdown(){const o=state.observation,d=o?.control?.deadlineAt;$('deadline').textContent=o?.status==='active'?(d?`本窗口剩余 ${Math.max(0,Math.ceil((d-Date.now()-(state.clockOffsetMs??0))/1000))} 秒`:'按游戏官方时钟进行'):'';}
$('join-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;$('join-button').disabled=true;$('status').textContent='正在连接…';$('light').className='yellow';latestMode=$('mode').value;
 try{render(await command('join',{invitation:$('invitation').value,name:$('name').value,mode:latestMode,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('api-key').value}));$('invitation').value='';}catch{$('status').textContent='连接失败';$('light').className='red';}finally{$('api-key').value='';busy=false;$('join-button').disabled=false;}};
$('mode').onchange=()=>{$('model-config').hidden=$('mode').value!=='model';};$('resume').onclick=()=>{latestMode='human';command('resume',{}).then(render).catch(()=>{});};
$('ready').onclick=()=>command('ready',{ready:!state.room?.members.find(p=>p.playerId===state.room.playerId)?.ready}).catch(()=>{});$('start').onclick=()=>command('start').catch(()=>{});$('invite').onclick=()=>command('invite').then(()=>{$('notice').textContent='新邀请已复制，旧邀请已失效。';}).catch(()=>{});
$('disconnect').onclick=()=>command('disconnect').then(render).catch(()=>{});$('action-type').onchange=renderAction;
$('action-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;$('act').disabled=true;try{const action={type:$('action-type').value};for(const input of $('action-fields').querySelectorAll('input,select,textarea')){if(!input.value&&!input.required)continue;action[input.name]=input.dataset.json?JSON.parse(input.value):input.dataset.number?Number(input.value):input.value;}render(await command('act',{action,observationId:state.observation.observationId}));}catch(error){$('notice').textContent=error.message;}finally{busy=false;$('act').disabled=false;}};
$('rules-button').onclick=()=>{const el=$('rules-content');el.replaceChildren();const rules=state.rules;if(!rules)el.append(node('p','加入房间后自动拉取本游戏规则。'));else{for(const rule of rules.rulesSummary)el.append(node('p',rule));el.append(node('h3','已实现 / 尚未实现'),node('pre',JSON.stringify(rules.implementation,null,2)));for(const source of rules.sources)el.append(node('p',`${source.title}\n${source.url}`));}$('rules-dialog').showModal();};$('close-rules').onclick=()=>$('rules-dialog').close();
api.onState(render);api.command('status').then(render).catch(()=>{$('status').textContent='启动失败';$('light').className='red';});setInterval(countdown,1000);
