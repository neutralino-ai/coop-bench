/* Focused human replay. No data from these combined audit views is sent to seats. */
(() => {
  const R = globalThis.CoopReplay;
  let epoch = 0, episode = '', seats = {}, busy = false;
  const dialog = (id, title) => {
    const box = node('dialog', 'audit-dialog'); box.id = id;
    const heading = node('header','drawer-heading'); heading.append(node('h2','',title));
    const close = node('button','icon-button','×'); close.type='button';close.setAttribute('aria-label','关闭');close.onclick=()=>box.close();heading.append(close);
    const content=node('div','drawer-content');box.append(heading,content);document.body.append(box);return {box,content};
  };
  const library=dialog('library-dialog','选择对局'), create=dialog('create-dialog','创建对局'), evidence=dialog('evidence-dialog','完整记录与技术证据'), full=dialog('decision-dialog','本次决策的原始记录');
  library.content.append(document.querySelector('.library'));
  create.content.append($('create-panel'));
  const detail=$('detail'), timeline=document.querySelector('.replay-panel');
  evidence.content.append($('episode-stats'),$('coverage-notice'),$('export-rollout'),$('copy-api'),document.querySelector('.audit-columns'));
  const toolbar=node('div','focus-toolbar');
  const addButton=(id,label,fn)=>{const b=node('button','button subtle',label);b.id=id;b.type='button';b.onclick=()=>{stopPlayback();fn();};toolbar.append(b);return b;};
  addButton('open-library','对局记录',()=>library.box.showModal());
  addButton('open-create','＋ 新对局',()=>{if(!state.token){$('auth-panel').hidden=false;return;}create.box.showModal();});
  addButton('open-evidence','完整记录',()=>evidence.box.showModal());
  document.querySelector('.top-actions').prepend(toolbar);
  const focus=node('section','focus-replay');focus.id='focus-replay';
  const shared=node('div','shared-board');shared.id='shared-board';
  const grid=node('div','player-grid');grid.id='player-grid';
  const chat=node('div','focus-communication');chat.id='focus-communication';
  focus.append(shared,grid,chat);detail.append(focus,timeline);
  const title=node('strong','focus-step-title');title.id='focus-step-title';timeline.prepend(title);
  const phase=node('span','focus-timing','手牌 / 可见信息：动作前');phase.id='focus-timing';document.querySelector('.episode-header-actions').prepend(phase);
  const more=node('button','button subtle','读取更多消息');more.id='focus-load-more';more.hidden=true;more.onclick=()=>load();evidence.content.prepend(more);

  function clear() {
    epoch++;episode='';seats={};busy=false;document.body.dataset.audit='false';
    for(const box of [library.box,create.box,evidence.box,full.box])if(box.open)box.close();
    grid.replaceChildren();shared.replaceChildren();chat.replaceChildren();full.content.replaceChildren();more.hidden=true;
  }
  async function load() {
    const id=state.rollout?.summary.episodeId;if(!id||!state.token)return;
    if(episode!==id){epoch++;episode=id;seats={};busy=false;}
    if(busy)return;busy=true;grid.dataset.messages='loading';const serial=epoch,session=state.session;
    const valid=()=>epoch===serial&&session===state.session&&state.rollout?.summary.episodeId===id;
    // Bounded pages per click, streaming progress. Larger traces remain available
    // in the paginated original-message viewer rather than freezing the renderer.
    let lastFetch=0;
    for(const player of state.rollout.players){
      const seat=seats[player]??(seats[player]={messages:[],bytes:0,after:-1,more:true,error:'',loading:true});
      if(seat.capped||seat.completion&&!seat.more)continue;
      seat.loading=true;seat.error='';
      try{
        for(let page=0;page<5;page++){
          // The API shares a 20/min heavy-read budget with exports/replays. Pace
          // background trace reads instead of exhausting it with parallel pages.
          const delay=Math.max(0,3100-(Date.now()-lastFetch));if(delay)await new Promise(resolve=>setTimeout(resolve,delay));
          if(!valid())return;lastFetch=Date.now();
          const data=await request(`/rollouts/${encodeURIComponent(id)}/messages?playerId=${encodeURIComponent(player)}&after=${seat.after}&limit=100`);
          if(!valid())return;
          if(!Array.isArray(data.messages))throw Error('消息响应不完整');
          const next=data.nextAfter;
          if(data.hasMore&&(!Number.isInteger(next)||next<=seat.after))throw Error('消息分页游标未前进');
          const bytes=JSON.stringify(data.messages).length;
          if(seat.bytes+bytes>8*1024*1024||seat.messages.length+data.messages.length>2000){seat.capped=true;seat.more=false;break;}
          seat.messages.push(...data.messages);seat.bytes+=bytes;seat.after=Number.isInteger(next)?next:seat.after;seat.more=!!data.hasMore;
          seat.completion=data.completion;render();if(!seat.more)break;
        }
      }catch(error){if(valid())seat.error='消息读取失败，可在完整记录中重试。';}
      finally{if(valid()){seat.loading=false;render();}}
    }
    if(valid()){busy=false;grid.dataset.messages='ready';more.hidden=!Object.values(seats).some(s=>s.more||s.error);more.textContent=Object.values(seats).some(s=>s.error)?'重试读取消息':'读取更多消息';render();}
  }
  const button=(label,fn)=>{const b=node('button','text-button',label);b.type='button';b.onclick=()=>{stopPlayback();fn();};return b;};
  function showOriginal(p) {
    const matches=R.linkedMessages(seats[p.player]?.messages??[],p.decision,p.player);
    full.content.replaceChildren(node('h3','',`${p.player} · ${p.decision ? `第 ${p.decision.seq} 步`:'尚未行动'}`));
    full.content.append(node('p','', '消息由运行器上传，按本动作的观察编号关联；不是服务器核验的模型内部过程。'));
    if(p.decision?.decisionSummary)full.content.append(node('h3','','行动时的决策简述'),node('pre','readable-original',p.decision.decisionSummary));
    const reasoning=R.reasoning(matches);
    for(const item of reasoning)full.content.append(node('h3','',item.label),node('pre','readable-original',item.text));
    if(!reasoning.length)full.content.append(node('p','muted','本动作尚无可读的 reasoning 原文。'));
    full.content.append(node('h3','','动作前精确输入'),node('pre','readable-original',p.decision?.observed?JSON.stringify(p.decision.observed,null,2):'没有记录动作前精确输入。'));
    for(const m of matches){const details=node('details','raw-details');details.append(node('summary','',`${m.kind??'message'} · ${m.sequence}`),node('pre','readable-original',JSON.stringify(m,null,2)));full.content.append(details);}
    if(!matches.length)full.content.append(node('p','muted','尚未载入可关联的原始消息。整局未关联消息见“完整记录”。'));
    if(!full.box.open)full.box.showModal();
  }
  function cardRow(cards, unknownText) {
    const row=node('div','audit-hand');
    if(!Array.isArray(cards)){row.append(node('p','muted',unknownText??'这个时点未记录手牌'));return row;}
    if(!cards.length)row.append(node('p','muted','手牌已空'));
    for(const [i,card] of cards.entries()){
      const tile=node('div','audit-card');const c=typeof card==='object'&&card!==null?card:{value:card};
      // Class names come only from this allowlist; model text never becomes markup.
      const known=['white','red','blue','yellow','green','solar','lunar'].includes(c.color);if(known)tile.className+=' '+c.color;
      tile.append(node('span','audit-card-color',c.color||c.suit?R.color(c.color??c.suit):c.cut?'已剪':' '),node('strong','',c.value??c.rank??'?'),node('small','',`${i+1}`));
      tile.title=`第 ${i+1} 张 · ${R.cardText(c)}`;row.append(tile);
    }
    return row;
  }
  function compact(value) {
    if(value===null||value===undefined)return '未记录';
    if(Array.isArray(value))return value.map(v=>typeof v==='object'?R.cardText(v):String(v)).join(' · ')||'无';
    if(typeof value==='object')return Object.entries(value).map(([k,v])=>`${R.color(k)} ${typeof v==='object'?JSON.stringify(v):v}`).join(' · ');
    return String(value);
  }
  function renderShared(snap) {
    shared.replaceChildren();const view=snap.views[state.rollout.players[0]]?.view??snap.players.find(p=>p.observation)?.observation?.view;
    if(!view){shared.append(node('span','','此时点的棋盘未记录'));return;}
    shared.append(node('span','shared-label','公共棋盘'));
    if(view.fireworks){
      const fireworks=node('div','firework-row');for(const [c,v] of Object.entries(view.fireworks))fireworks.append(node('span',`firework ${['white','red','blue','yellow','green'].includes(c)?c:''}`,`${R.color(c)} ${v}`));shared.append(fireworks);
      shared.append(node('strong','',`${Object.values(view.fireworks).reduce((a,b)=>a+Number(b),0)} / 25`),node('span','',`提示 ${view.hints} · 失误 ${view.errors} · 牌库 ${view.deckCount}`));
    }else if(state.rollout.summary.gameId==='take-time'){
      const slots=node('div','clock-overview');for(let n=1;n<=6;n++){const cards=(view.placements??[]).filter(p=>p.position===n);slots.append(node('span','',`${n}号位：${cards.length?cards.map(c=>c.value??'?').join(' + '):'空'}`));}shared.append(slots,node('span','',phaseNames[view.phase]??view.phase??''));
    }else{
      const keys=['phase','current','level','hints','lives','piles','stacks','trick','tasks','position','altitude','speed'];
      for(const k of keys.filter(k=>view[k]!==undefined).slice(0,5))shared.append(node('span','',`${labels[k]??k}：${compact(view[k])}`));
    }
    shared.append(button('展开棋盘',()=>{evidence.box.showModal();document.querySelector('.board-panel').scrollIntoView({block:'start'});}));
  }
  function renderPlayer(p,snap) {
    const actor=snap.frame?.playerId===p.player;
    const panel=node('article',`player-panel${actor?' acting':''}`);panel.dataset.player=p.player;
    const head=node('div','player-heading');head.append(node('h2','',`玩家 ${p.player.replace(/^p/,'')}`),node('span','player-turn',actor?'本步行动者':'观察 / 等待'));panel.append(head);
    const game=state.rollout.summary.gameId;
    const hand=node('section','player-hand');hand.append(node('h3','',game==='sky-team'?'手中的骰子':game==='bomb-busters'?'面前的电线':game==='magic-maze'?'行动能力':'手里是什么牌'),node('span','audit-scope',game==='hanabi'?'审计可见 · 玩家不见牌面':'这个时点已记录的信息'));
    const backs=p.observation?.view?.cardBacks?.[p.player]?.hand;
    hand.append(cardRow(p.actual??(backs?.map(color=>({color}))),p.observation?'牌面未知 / 本游戏没有手牌':'历史视角缺失'));panel.append(hand);
    const visibility=node('section',`player-visibility${game==='hanabi'?' hanabi-knowledge':''}`);visibility.append(node('h3','',game==='hanabi'?'自身提示 · 可见队友牌面':'它当时能看到什么'));
    if(state.rollout.summary.gameId==='hanabi'&&Array.isArray(p.hand)){
      visibility.append(node('p','', '队友牌面与公共棋盘；自己的牌只知道提示。'));
      const knowledge=node('div','knowledge-row');
      for(const c of p.hand){
        const k=node('div','knowledge-card'),colors=c.possibleColors??[],values=c.possibleValues??[];
        const colorLabel=colors.length===5?'颜色未知':colors.length===4?`非${R.color(['white','red','blue','yellow','green'].find(v=>!colors.includes(v)))}`:colors.length?colors.map(R.color).join(' / '):'未记录';
        const valueLabel=values.length===5?'1–5':values.length===4?`非 ${[1,2,3,4,5].find(v=>!values.includes(v))}`:values.join('/')||'?';
        k.title=`可能颜色：${colors.map(R.color).join('、')}；可能数字：${values.join('、')}`;
        k.append(node('span','',colorLabel),node('strong','',valueLabel));knowledge.append(k);
      }visibility.append(knowledge);
    }else if(p.observation){
      const v=p.observation.view;
      const text=state.rollout.summary.gameId==='take-time'?v.hand===null?'太阳 / 月亮牌背及公开放牌位置；尚未看自己的点数。':'自己的手牌、公开牌背与放牌位置；队友暗牌点数未知。':`记录的合法视角 · 可选动作：${(p.observation.legalActions??[]).map(a=>a.type).join('、')||'无'}`;
      visibility.append(node('p','',text));
    }else visibility.append(node('p','muted','未保存这个时点的合法视角。'));
    visibility.append(button(p.exact?'动作绑定的真实输入 ↗':'查看已录制的可见状态 ↗',()=>{full.content.replaceChildren(node('h3','',`${p.player} · ${p.exact?'本动作绑定的输入':'服务器投影；不代表 Agent 已读取'}`),node('pre','readable-original',JSON.stringify(p.observation,null,2)));full.box.showModal();}));panel.append(visibility);
    const decision=node('section','player-decision');
    const decisionHead=node('div','decision-heading');decisionHead.append(node('h3','',p.decisionIndex===state.index?'这一步怎么想':'最近一次决策'),node('span','decision-step',p.decision?`第 ${p.decision.seq} 步`:'尚未行动'));decision.append(decisionHead);
    const matched=R.linkedMessages(seats[p.player]?.messages??[],p.decision,p.player),thoughts=R.reasoning(matched);
    const reasoning=thoughts.length?thoughts.map(t=>t.text).join('\n'):p.decision?.decisionSummary;
    decision.append(node('span','thinking-source',thoughts.length?`${thoughts[0].label} · 客户端来源未核验`:p.decision?.decisionSummary?'决策简述 · 非完整 thinking':'没有已记录的决策简述'));
    decision.append(node('p','thinking-excerpt',reasoning??(p.decision?'该步没有可读的思考记录。':'还没有轮到它行动。')));
    const status=seats[p.player];if(status?.error||status?.loading||status?.more||status?.capped)decision.append(node('span','trace-status',status.error|| (status.capped?'大轨迹 · 在完整记录中分页查看':status.loading?'正在读取对应消息…':'消息未全部读取 · 完整记录中可继续读取')));
    decision.append(button('完整输入 / 思考 / 消息 ↗',()=>showOriginal(p)));panel.append(decision);
    const action=node('section',`player-action${p.decision?.error?' rejected-action':''}`);action.append(node('span','action-label',p.decisionIndex===state.index?'做了什么':'上次做了什么'),node('strong','action-description',p.decision?R.actionText(p.decision):'等待行动'));
    if(p.decision?.error)action.append(node('span','','服务器拒绝，未生效'));
    if(p.decision&&p.decisionIndex!==state.index)action.append(button('跳到这一步',()=>{stopPlayback();selectFrame(p.decisionIndex);}));panel.append(action);return panel;
  }
  function render() {
    if(!state.rollout)return;document.body.dataset.audit='true';const snap=R.snapshot(state.rollout,state.index);

    $('open-create').hidden=state.identity?.role==='auditor';
    setText('focus-timing',snap.frame?.action?'手牌 / 可见信息：动作前':'手牌 / 可见信息：此时点');
    setText('focus-step-title',`${snap.frame?.seq===0?'初始局面':`第 ${snap.frame?.seq??0} 步`} · ${snap.frame?.playerId??'系统'} · ${R.actionText(snap.frame)}`);
    grid.dataset.count=String(snap.players.length);grid.replaceChildren(...snap.players.map(p=>renderPlayer(p,snap)));renderShared(snap);
    const communications=state.rollout.frames.slice(0,state.index+1).map(f=>({frame:f,text:publicCommunication(f)})).filter(m=>m.text);
    const last=communications.at(-1);chat.replaceChildren(node('strong','','公开交流'),node('span','chat-preview',last?`${last.frame.playerId} · ${last.text}`:'截至这一步还没有公开交流。'));
    chat.append(button(`全部 ${communications.length} 条 ↗`,()=>{evidence.box.showModal();$('communication-panel').scrollIntoView({block:'start'});}));
  }
  window.CoopFocus={clear,load,render,selected(){epoch++;episode='';seats={};busy=false;if(library.box.open)library.box.close();if(full.box.open)full.box.close();full.content.replaceChildren();}};
  window.addEventListener('keydown',event=>{
    if(!state.rollout||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();stopPlayback();selectFrame(state.index+(event.key==='ArrowRight'?1:-1));}
  });
  if(state.rollout){render();void load();}
})();
