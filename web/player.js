const $=id=>document.getElementById(id),api=window.coopPlayer;let state={},actionSchema,latestMode='human',busy=false,shownObservationId=null,cardSelection=null,cardAction=null;
const names={'disconnected':'尚未连接','connecting':'连接中…','waiting':'已连接 · 等待','your-turn':'已连接 · 轮到你','thinking':'Agent 正在思考','submitting':'正在提交','reconnecting':'连接中断 · 正在重连','ended':'游戏结束','access-denied':'席位凭证被拒绝','room-closed':'房间已关闭'};
const node=(tag,text='',className='')=>{const el=document.createElement(tag);el.textContent=text;if(className)el.className=className;return el;};
const colorName={white:'白',red:'红',blue:'蓝',yellow:'黄',green:'绿'};
const actionNames={hint:'提示队友',play:'出牌',discard:'弃牌',speak:'公开讨论',look_hand:'查看自己的牌',place:'放置',ready:'准备',end_turn:'结束回合',claim:'领取筹码',select_task:'领取任务',distress_vote:'救援投票',distress_pass:'传递手牌',reroll_selection:'完成重掷选择',place_info:'放置信息标记',finish_cut:'完成剪线',detector_response:'回答探测',choose_start:'选择起点',solo_cut:'单人剪线',dual_cut:'合作剪线',communicate:'规则允许的沟通'};
const fieldNames={index:'第几张牌',target:'目标玩家',kind:'提示类型',value:'数字 / 颜色',text:'发言内容',position:'位置',cardId:'手牌编号',faceUp:'明置牌面'};
async function command(name,input){try{$('notice').textContent='';return await api.command(name,input);}catch(error){$('notice').textContent=error.message;throw error;}}
function render(next){if(state.room?.roomId!==next.room?.roomId||state.observation?.observationId!==next.observation?.observationId)$('decision-reason').value='';state=next;if(next.mode)latestMode=next.mode;$('status').textContent=names[next.status]??next.status;$('light').className=['access-denied','room-closed'].includes(next.status)?'red':['connecting','reconnecting','submitting'].includes(next.status)?'yellow':next.room?'green':'';
 if(next.lobbyManaged){$('join-form').hidden=true;$('join').querySelector('p').textContent='请回到主窗口的“加入对局”，选择新房间或“返回我的对局”。';}
 $('join').hidden=Boolean(next.room);$('disconnect').hidden=!next.room;$('disconnect').textContent=next.lobbyManaged?'返回大厅':'暂时离开';$('lobby').hidden=!next.room||Boolean(next.room.episodeId);$('game').hidden=!next.observation;
 $('resume').disabled=busy||!next.canResume&&!next.room;$('session-mode').textContent=next.room?(latestMode==='model'?'模型 API 自动参赛':'人类玩家'):'邀请制 · 每个客户端只持有自己的席位';
 $('progress').hidden=!['connecting','reconnecting','submitting','thinking'].includes(next.status);$('progress-text').textContent=next.status==='thinking'?'模型正在根据本席可见信息决策。':next.status==='submitting'?'正在确认动作是否被服务器接受…':next.status==='reconnecting'?'连接中断，运行器正在重连；服务端倒计时继续。':'正在加入房间并读取规则…';
 if(next.warning)$('notice').textContent=next.warning;
 if(next.room){$('game-name').textContent=next.room.name||next.rules?.name||next.room.gameId;$('room-status').textContent=`${next.rules?.name??next.room.gameId} · ${next.room.scenarioId} · ${next.room.members.length}/${next.room.playerCount} 人 · 成员变化后需重新准备`;
  $('members').replaceChildren();for(const p of next.room.members){const card=node('div','', 'member');card.append(node('strong',`${p.name}${p.playerId===next.room.playerId?'（我）':''}`),node('div',p.ready?'✓ 已准备':'等待准备'));
   if(next.room.playerId===next.room.hostPlayerId&&p.playerId!==next.room.playerId){const b=node('button','移出');b.onclick=()=>command('kick',{playerId:p.playerId}).catch(()=>{});card.append(b);}$('members').append(card);}
  const me=next.room.members.find(p=>p.playerId===next.room.playerId);$('ready').hidden=Boolean(next.autoReady);$('ready').textContent=me?.ready?'取消准备':'准备好了';$('start').hidden=$('invite').hidden=next.room.playerId!==next.room.hostPlayerId;
  $('start').disabled=next.room.members.length!==next.room.playerCount||!next.room.members.every(p=>p.ready);
 }
 renderHistory(next);
 if(!next.observation){shownObservationId=null;clearCardSelection();}
 if(next.observation&&next.observation.observationId!==shownObservationId){const o=next.observation;shownObservationId=o.observationId;$('phase').textContent=o.status==='active'?`${next.room?.name||next.rules?.name||'游戏'} · 我是 ${o.playerId}`:o.status==='truncated'?'对局已中断':o.outcome?`结束 · ${o.outcome.score}${o.outcome.maxScore?'/'+o.outcome.maxScore:''} 分`:'游戏结束';
  $('outcome').hidden=o.status==='active';$('outcome').textContent=o.status==='truncated'?`原因：${o.control?.endReason??'服务器中断本局'}。这是中断记录，不等同于按游戏规则失败。`:`${o.outcome?.success===true?'团队成功。':o.outcome?.success===false?'团队未达成目标。':''}${o.outcome?.reason??''}`;
  cardSelection=null;cardAction=null;renderBoard(o);
  const old=$('action-type').value;$('action-type').replaceChildren();for(const a of o.legalActions){const option=node('option',actionNames[a.type]??a.type);option.value=a.type;$('action-type').append(option);}if(o.legalActions.some(a=>a.type===old))$('action-type').value=old;
  $('action-form').hidden=isCardBoard(o)||latestMode==='model'||!o.legalActions.length||o.status!=='active';
  if($('action-form').hidden){actionSchema=null;$('action-fields').replaceChildren();$('action-description').textContent='';}else renderAction();
 }
 countdown();
}
function tokenCounter(label,count,total,className){const el=node('div','','token-counter '+className);el.setAttribute('role','img');el.setAttribute('aria-label',`${label} ${count}，共 ${total} 枚`);el.append(node('span',label,'metric-label'));const dots=node('span','','token-dots');dots.setAttribute('aria-hidden','true');for(let i=0;i<total;i++)dots.append(node('i','','token-dot'+(i<count?' filled':'')));el.append(dots);return el;}
function knowledgeText(card){const colors=card.possibleColors,values=card.possibleValues;return [!colors?'未提供颜色':colors.length===5?'颜色未知':colors.length===4?'非'+colorName[Object.keys(colorName).find(c=>!colors.includes(c))]:colors.map(c=>colorName[c]??c).join(' / '),!values?'未提供数字':values.length===5?'1–5':values.length===4?'非 '+[1,2,3,4,5].find(v=>!values.includes(v)):values.join(' / ')];}
function renderBoard(o){const board=$('board');board.replaceChildren();const v=o.view;
 if(v.fireworks&&v.hands){const metrics=node('div','','metrics');metrics.append(tokenCounter('剩余提示',v.hints,8,'hint-counter'),tokenCounter('失误',v.errors,3,'error-counter'));const deck=node('div','','deck-counter');deck.append(node('span','牌库','metric-label'),node('strong',String(v.deckCount)));metrics.append(deck);board.append(metrics);
  const piles=node('div','','firework-piles');for(const [color,value]of Object.entries(v.fireworks)){const pile=node('div','','firework-pile '+color);pile.append(node('span',colorName[color]??color),node('strong',String(value)));piles.append(pile);}board.append(piles);
  board.append(node('p','牌面与提示知识分开展示 · 将鼠标停在提示上可查看完整范围','knowledge-note'));
  for(const [p,hand]of Object.entries(v.hands)){const section=node('section','','player-hand'+(p===v.current?' active-hand':''));const heading=node('div','','hand-heading');heading.append(node('strong',p===o.playerId?'我的手牌':`${playerName(p)} 的手牌`),node('span',p===v.current?'正在行动':p===o.playerId?'牌面仅队友可见':'提示知识公开','hand-status'));section.append(heading);const cards=node('div','','cards');for(const [i,c]of hand.entries()){
    const color=Object.hasOwn(colorName,c.color)?c.color:'';const card=node('button','','card '+color);card.type='button';card.dataset.player=p;card.dataset.index=String(i);card.setAttribute('aria-pressed','false');card.setAttribute('aria-label',`${p===o.playerId?'我的':playerName(p)+'的'}第 ${i+1} 张牌${p===o.playerId?'，未知牌面':`，${colorName[c.color]??c.color} ${c.value}`}`);card.onclick=()=>selectCard(p,i);card.disabled=!canSubmitAction()||!cardChoices(p,i).length;const face=node('span','','card-face');face.append(node('small',`第 ${i+1} 张`),node('strong',c.color?String(c.value??c.rank??'?'):'?'),node('span',c.color?(colorName[c.color]??c.color)+'色':'未知牌面'));card.append(face);
    const knowledge=node('span','','card-knowledge');knowledge.title=`可能颜色：${c.possibleColors?.map(color=>colorName[color]??color).join('、')??'未提供'}；可能数字：${c.possibleValues?.join('、')??'未提供'}`;knowledge.append(node('span',p===o.playerId?'我知道':'牌主知道','knowledge-label'),...knowledgeText(c).map(text=>node('span',text,'knowledge-value')));card.append(knowledge);cards.append(card);
  }section.append(cards);board.append(section);}return;
 }
 for(const [key,value]of Object.entries(v)){const row=node('div','','generic-field');row.append(node('b',key),node(typeof value==='object'?'pre':'div',typeof value==='object'?JSON.stringify(value,null,2):String(value)));board.append(row);}
}
function isCardBoard(o=state.observation){return Boolean(o?.view?.fireworks&&o.view.hands);}
function canSubmitAction(){const o=state.observation;return !busy&&latestMode==='human'&&o?.status==='active'&&!['connecting','reconnecting','submitting','access-denied','room-closed','disconnected'].includes(state.status)&&(!o.control?.deadlineAt||o.control.deadlineAt>Date.now()+(state.clockOffsetMs??0));}
function allowsValue(schema,value){if(!schema)return false;const values=schemaValues(schema);if(values&&!values.includes(value))return false;if(schema.type==='integer'&&!Number.isInteger(value))return false;return !(schema.minimum!==undefined&&value<schema.minimum||schema.maximum!==undefined&&value>schema.maximum);}
function allowsCardAction(action){const schema=state.observation?.legalActions.find(a=>a.type===action.type)?.schema;if(!schema)return false;const matches=properties=>Object.entries(properties??{}).every(([key,s])=>action[key]===undefined?!(schema.required??[]).includes(key):allowsValue(s,action[key]));return matches(schema.properties)&&(!schema.oneOf||schema.oneOf.some(branch=>matches(branch.properties)));}
function cardChoices(player,index){
 const o=state.observation,card=o?.view?.hands?.[player]?.[index];if(!card)return [];
 const actions=player===o.playerId?[{type:'play',index},{type:'discard',index}]:[{type:'hint',target:player,kind:'color',value:card.color},{type:'hint',target:player,kind:'value',value:card.value}];
 return actions.filter(action=>allowsCardAction(action));
}
function clearCardSelection(){cardSelection=null;cardAction=null;renderCardSelection();}
function selectCard(player,index){if(!canSubmitAction()||!cardChoices(player,index).length)return;cardSelection={player,index,observationId:state.observation.observationId};cardAction=null;renderCardSelection();$('card-action-choices')?.querySelector('button')?.focus();}
function renderCardSelection(){
 $('card-action-panel')?.remove();
 for(const card of $('board').querySelectorAll('.card')){card.classList.remove('card-selected','card-preview','hint-excluded');card.setAttribute('aria-pressed','false');card.querySelector('.card-mark')?.remove();}
 if(!cardSelection)return;
 const {player,index,observationId}=cardSelection,o=state.observation;if(!o||observationId!==o.observationId){cardSelection=null;cardAction=null;return;}
 const cards=[...$('board').querySelectorAll('.card')],selected=cards.find(c=>c.dataset.player===player&&Number(c.dataset.index)===index);if(!selected)return;
 selected.classList.add('card-selected');selected.setAttribute('aria-pressed','true');const affected=[];
 for(const el of cards){const i=Number(el.dataset.index),target=el.dataset.player===player,face=o.view.hands[player][i];const match=cardAction&&target&&(cardAction.type==='hint'?face?.[cardAction.kind==='color'?'color':'value']===cardAction.value:i===index);
  if(match){affected.push(i+1);el.classList.add('card-preview');el.append(node('span',cardAction.type==='hint'?'提示':cardAction.type==='play'?'出':'弃','card-mark'));}else if(cardAction?.type==='hint'&&target)el.classList.add('hint-excluded');
 }
 const panel=node('div','','card-action-panel');panel.id='card-action-panel';panel.setAttribute('aria-label','选牌与确认');const top=node('div','','card-action-heading');top.append(node('strong',`${player===o.playerId?'我的':playerName(player)+'的'}第 ${index+1} 张牌`),node('span',cardAction?'确认前可更换选择':'选择动作','card-action-step'));panel.append(top);
 const choices=node('div','','card-action-choices');choices.id='card-action-choices';
 for(const action of cardChoices(player,index)){const same=JSON.stringify(action)===JSON.stringify(cardAction),label=action.type==='play'?'出':action.type==='discard'?'弃':action.kind==='color'?`颜色 · ${colorName[action.value]??action.value}`:`数字 · ${action.value}`;const b=node('button',label);b.type='button';b.dataset.choice=action.type==='hint'?action.kind:action.type;b.setAttribute('aria-pressed',String(same));b.onclick=()=>{if(!canSubmitAction())return;cardAction=action;renderCardSelection();$('confirm-card-action')?.focus();};choices.append(b);}panel.append(choices);
 const preview=node('p',!cardAction?'选择上面的动作，查看高亮后再确认。':cardAction.type==='hint'?`向 ${playerName(player)} 提示${cardAction.kind==='color'?'颜色 '+(colorName[cardAction.value]??cardAction.value):'数字 '+cardAction.value}，命中第 ${affected.join('、')} 张牌。消耗 1 枚提示。`:`${cardAction.type==='play'?'打出':'弃掉'}自己的第 ${index+1} 张牌。`,'card-action-preview');preview.id='card-action-preview';preview.setAttribute('role','status');panel.append(preview);
 const buttons=node('div','','card-action-buttons'),cancel=node('button','取消'),confirm=node('button',cardAction?.type==='hint'?'确认提示':cardAction?.type==='play'?'确认出牌':cardAction?.type==='discard'?'确认弃牌':'先选择动作');cancel.type=confirm.type='button';cancel.id='cancel-card-action';confirm.id='confirm-card-action';confirm.className='confirm-card-action';confirm.disabled=!cardAction||!canSubmitAction();cancel.onclick=()=>{clearCardSelection();if(!selected.disabled)selected.focus();};confirm.onclick=()=>{if(!cardAction||!canSubmitAction()||cardSelection?.observationId!==state.observation?.observationId||!allowsCardAction(cardAction))return;void submitAction({...cardAction},cardSelection.observationId);};buttons.append(cancel,confirm);panel.append(buttons);selected.closest('.player-hand').append(panel);
}
async function submitAction(action,observationId){if(!canSubmitAction()||observationId!==state.observation?.observationId)return;busy=true;countdown();try{const decisionSummary=$('decision-reason').value.trim();const next=await command('act',{action,observationId,...(decisionSummary?{decisionSummary}:{})});$('decision-reason').value='';clearCardSelection();render(next);}catch(error){$('notice').textContent=error.message;}finally{busy=false;countdown();}}
function updateCardAvailability(){for(const card of $('board').querySelectorAll('button.card'))card.disabled=!canSubmitAction()||!cardChoices(card.dataset.player,Number(card.dataset.index)).length;for(const button of $('card-action-choices')?.querySelectorAll('button')??[])button.disabled=!canSubmitAction();const confirm=$('confirm-card-action');if(confirm)confirm.disabled=!canSubmitAction()||!cardAction;}
$('board').addEventListener('keydown',event=>{if(event.key==='Escape'&&cardSelection){event.preventDefault();$('cancel-card-action')?.click();}});
function playerName(id){const member=state.room?.members?.find(p=>p.playerId===id);return member?`${member.name}（${id}）`:id??'玩家';}
function eventText(event){
 const who=playerName(event.player),value=event.kind==='color'?(colorName[event.value]??event.value):event.value;
 if(event.type==='hint')return `${who} → ${playerName(event.target)}：提示${event.kind==='color'?'颜色':'数字'} ${value}；${event.touched?.length?'命中第 '+event.touched.map(i=>i+1).join('、')+' 张牌':Array.isArray(event.touched)?'没有匹配的牌':'命中位置未提供'}。`;
 if(event.type==='play'||event.type==='discard'){const card=event.card,face=card?`${colorName[card.color]??card.color} ${card.value}`:'牌面未提供';return `${who} ${event.type==='play'?'打出':'弃掉'}第 ${Number(event.index)+1} 张牌（${face}）${event.type==='play'?(event.played?'，成功':'，失败'):''}。`;}
 return `${who} · ${actionNames[event.type]??event.type}：${JSON.stringify(event)}`;
}
function renderHistory(next){
 const list=$('action-history');if(!list)return;
 const entries=next.visibleHistory??(next.observation?.updates??[]).map(u=>({...u,event:u.view?.lastEvent}));
 const events=[];let previous=null;
 for(const entry of entries){const event=entry.event;if(!event)continue;const key=JSON.stringify(event);if(key!==previous)events.push(entry);previous=key;}
 // A page can arrive without changing observationId; update history independently.
 const signature=JSON.stringify([next.room?.roomId,events]);if(list.dataset.signature===signature)return;list.dataset.signature=signature;list.replaceChildren();
 $('history-status').textContent=next.observation?.hasMore?'正在读取更早的可见记录…':events.length?`已收到 ${events.length} 条动作 · 最新在前`:'尚未收到动作记录。';
 for(const entry of events.reverse()){const item=node('li',eventText(entry.event));if(entry.preparedAt){const time=new Date(entry.preparedAt);if(!Number.isNaN(time.getTime()))item.append(node('small',time.toLocaleTimeString(),'history-time'));}list.append(item);}
}
function schemaValues(s){return s?.enum??(s&&Object.hasOwn(s,'const')?[s.const]:s?.anyOf?.every(v=>Array.isArray(v.enum))?s.anyOf.flatMap(v=>v.enum):null);}
function selectOptions(input,name,values){const old=input.value;input.replaceChildren();for(const value of values){const text=name==='target'?playerName(value):name==='kind'?({color:'颜色',value:'数字'}[value]??value):name==='index'&&Number.isInteger(value)?`第 ${value+1} 张牌`:colorName[value]??String(value);const option=node('option',text);option.value=JSON.stringify(value);input.append(option);}if([...input.options].some(o=>o.value===old))input.value=old;input.dataset.json='true';}
function renderAction(){const a=state.observation?.legalActions.find(a=>a.type===$('action-type').value);actionSchema=a?.schema;$('action-fields').replaceChildren();$('action-description').textContent=a?.description??'';
 for(const [name,s]of Object.entries(actionSchema?.properties??{})){if(name==='type')continue;const label=node('label',fieldNames[name]??name),values=schemaValues(s);let input;
  if(values||s.type==='boolean'){input=node('select');selectOptions(input,name,values??[true,false]);}
  else {input=node(s.type==='array'||s.type==='object'?'textarea':'input');if(s.type==='integer'||s.type==='number'){const offset=name==='index'?1:0;input.type='number';input.min=s.minimum===undefined?'':s.minimum+offset;input.max=s.maximum===undefined?'':s.maximum+offset;input.step=s.type==='integer'?'1':'any';input.dataset.number='true';input.dataset.offset=String(offset);if(offset&&s.minimum!==undefined)input.value=String(s.minimum+offset);}if(s.type==='array'||s.type==='object'){input.value=s.type==='array'?'[]':'{}';input.dataset.json='true';}if(s.maxLength)input.maxLength=s.maxLength;}
  input.name=name;input.required=(actionSchema.required??[]).includes(name);label.append(input);$('action-fields').append(label);
 }
 const kind=$('action-fields').querySelector('select[name=kind]'),value=$('action-fields').querySelector('select[name=value]');
 if(a?.type==='hint'&&kind&&value){const refresh=()=>{const selected=JSON.parse(kind.value),branch=actionSchema.oneOf?.find(s=>s.properties?.kind?.const===selected),allowed=schemaValues(branch?.properties?.value)??schemaValues(actionSchema.properties.value)??[];
   selectOptions(value,'value',allowed.filter(v=>selected==='color'?typeof v==='string':selected==='value'?typeof v==='number':true));value.parentElement.firstChild.textContent=selected==='color'?'提示颜色':selected==='value'?'提示数字':fieldNames.value;
  };kind.onchange=refresh;refresh();}
}
function countdown(){
 $('reason-panel').hidden=latestMode!=='human'||state.observation?.status!=='active';$('decision-reason').disabled=!canSubmitAction();$('dictate-reason').disabled=!canSubmitAction();
 const o=state.observation,active=o?.status==='active',d=o?.control?.deadlineAt,remaining=Number.isFinite(d)?Math.max(0,Math.ceil((d-Date.now()-(state.clockOffsetMs??0))/1000)):null;
 const current=o?.view?.current,own=Boolean(active&&(o.control?.required||current===o.playerId)),actor=state.room?.members?.find(p=>p.playerId===current)?.name??current;
 const label=!active?o?.status==='truncated'?'对局已中断':o?'对局已结束':'等待对局开始':own?latestMode==='model'?'Agent 行动中':'轮到你了':actor?`${actor} 行动中`:'等待队友行动';
 if($('turn-label').textContent!==label)$('turn-label').textContent=label;
 $('turn-panel').classList.toggle('own-turn',own);$('turn-panel').classList.toggle('urgent',active&&remaining!==null&&remaining<=10);
 $('deadline').hidden=!active||remaining===null;$('deadline').textContent=active&&remaining!==null?`${String(Math.floor(remaining/60)).padStart(2,'0')}:${String(remaining%60).padStart(2,'0')}`:'';
 $('deadline').setAttribute('aria-label',active&&remaining!==null?`剩余 ${remaining} 秒`:'');
 $('timeout-policy').textContent=!active?'':remaining===0?o.control?.timeoutPolicy==='default-action-v1'?'时间到，等待服务器执行默认动作':'时间到，等待服务器裁决':remaining===null?'按游戏规则行动':o.control?.timeoutPolicy==='default-action-v1'?'超时后自动行动，游戏继续':'请在倒计时结束前完成行动';
 $('act').disabled=busy||!active||latestMode==='model'||['connecting','reconnecting','submitting','access-denied','room-closed'].includes(state.status)||remaining===0;updateCardAvailability();
}
$('join-form').onsubmit=async event=>{event.preventDefault();if(busy)return;busy=true;$('join-button').disabled=true;$('status').textContent='正在连接…';$('light').className='yellow';latestMode=$('mode').value;
 try{render(await command('join',{invitation:$('invitation').value,seatToken:$('seat-token').value,name:$('name').value,mode:latestMode,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('api-key').value}));$('invitation').value='';}catch{$('status').textContent='连接失败';$('light').className='red';$('progress').hidden=true;}finally{$('seat-token').value='';$('api-key').value='';busy=false;$('join-button').disabled=false;countdown();}};
$('mode').onchange=()=>{$('model-config').hidden=$('mode').value!=='model';for(const id of ['base-url','model','api-key'])$(id).required=$('mode').value==='model';};$('resume').onclick=async()=>{if(busy)return;if($('mode').value==='model'&&!['base-url','model','api-key'].every(id=>$(id).reportValidity()))return;busy=true;$('resume').disabled=true;latestMode=$('mode').value;try{render(await command('resume',{mode:latestMode,baseUrl:$('base-url').value,model:$('model').value,apiKey:$('api-key').value}));}catch{$('status').textContent='恢复失败';$('light').className='red';$('progress').hidden=true;}finally{$('seat-token').value='';$('api-key').value='';busy=false;$('resume').disabled=false;}};
$('ready').onclick=()=>command('ready',{ready:!state.room?.members.find(p=>p.playerId===state.room.playerId)?.ready}).catch(()=>{});$('start').onclick=()=>command('start').catch(()=>{});$('invite').onclick=()=>command('invite').then(()=>{$('notice').textContent='新邀请已复制，旧邀请已失效。';}).catch(()=>{});
$('disconnect').onclick=()=>command('disconnect').then(render).catch(()=>{});$('action-type').onchange=renderAction;
const leave=node('button','释放席位');leave.id='leave-room';leave.type='button';leave.onclick=()=>command('leave').then(render).catch(()=>{});$('ready').parentElement.append(leave);
$('action-form').onsubmit=async event=>{event.preventDefault();if($('action-form').hidden||!canSubmitAction())return;try{const action={type:$('action-type').value};for(const input of $('action-fields').querySelectorAll('input,select,textarea')){if(!input.value&&!input.required)continue;action[input.name]=input.dataset.json?JSON.parse(input.value):input.dataset.number?Number(input.value)-Number(input.dataset.offset??0):input.value;}await submitAction(action,state.observation.observationId);}catch(error){$('notice').textContent=error.message;}};
$('rules-button').onclick=()=>{const el=$('rules-content');el.replaceChildren();const rules=state.rules;if(!rules)el.append(node('p','加入房间后自动拉取本游戏规则。'));else{for(const rule of rules.rulesSummary)el.append(node('p',rule));el.append(node('h3','已实现 / 尚未实现'),node('pre',JSON.stringify(rules.implementation,null,2)));for(const source of rules.sources)el.append(node('p',`${source.title}\n${source.url}`));}$('rules-dialog').showModal();};$('close-rules').onclick=()=>$('rules-dialog').close();
function acceptInvitation(value){if(typeof value!=='string'||!value)return;$('invitation').value=value;$('notice').textContent=state.room?'收到新邀请。断开当前席位后，可确认并加入新房间。':'邀请已填入。选择人类或模型模式，确认后加入房间。';if(!state.room)$('name').focus();}
if(api.dictate){$('dictate-reason').hidden=false;$('dictate-reason').onclick=async()=>{const id=state.observation?.observationId,room=state.room?.roomId;try{const text=await api.dictate();if(text&&id===state.observation?.observationId&&room===state.room?.roomId){$('decision-reason').value=[$('decision-reason').value.trim(),text].filter(Boolean).join(' ').slice(0,1200);$('decision-reason').focus();}}catch(error){$('notice').textContent=error.message;}};}
api.onState(render);api.onInvitation(acceptInvitation);api.command('incoming-invitation').then(acceptInvitation).catch(()=>{});api.command('status').then(render).catch(()=>{$('status').textContent='启动失败';$('light').className='red';});setInterval(countdown,1000);
