/* Focused human replay. No data from these combined audit views is sent to seats. */
(() => {
  const R = globalThis.CoopReplay;
  let epoch = 0, episode = '', seats = {}, busy = false, controller;
  let recording=null,recordingError='',recordingBusy=false,recordingAt=0,recordingEpisode='';
  let readCredits=4, creditAt=Date.now();
  const dialog = (id, title) => {
    const box = node('dialog', 'audit-dialog'); box.id = id;
    const heading = node('header','drawer-heading'); heading.append(node('h2','',title));
    const close = node('button','icon-button','×'); close.type='button';close.setAttribute('aria-label','关闭');close.onclick=()=>box.close();heading.append(close);
    const content=node('div','drawer-content');box.append(heading,content);document.body.append(box);return {box,content};
  };
  const library=dialog('library-dialog','选择对局'), create=dialog('create-dialog','创建新房间'), evidence=dialog('evidence-dialog','完整记录与技术证据'), full=dialog('decision-dialog','本次决策的原始记录'), rules=dialog('rules-dialog','游戏规则'), recordingDialog=dialog('recording-dialog','本局轨迹收集状态');
  $('home-replays').append(document.querySelector('.library'));
  create.content.append($('create-panel'));
  document.querySelector('.brand').onclick=event=>{event.preventDefault();window.CoopLobby.home();};
  const detail=$('detail'), timeline=document.querySelector('.replay-panel');
  evidence.content.append($('episode-stats'),$('coverage-notice'),$('export-rollout'),$('copy-api'),document.querySelector('.audit-columns'));
  const toolbar=node('div','focus-toolbar');
  const addButton=(id,label,fn)=>{const b=node('button','button subtle',label);b.id=id;b.type='button';b.onclick=()=>{stopPlayback();fn();};toolbar.append(b);return b;};
  addButton('open-library','← 返回大厅',()=>window.CoopLobby.home());
  addButton('open-create','＋ 创建新房间',()=>{if(!state.token){$('auth-panel').hidden=false;return;}window.CoopRooms.newRoom();create.box.showModal();});
  addButton('open-join','加入房间',()=>window.CoopLobby.home());
  const openEvidence=()=>{evidence.box.showModal();if(!state.artifacts.length&&!state.artifactLoading)void loadArtifacts();if(!state.modelMessages.length&&!state.modelMessageLoading)void loadModelMessages();};
  addButton('open-evidence','完整记录',openEvidence);
  addButton('open-rules','游戏规则',showRules);
  const issuedDialog=dialog('issued-observations-dialog','输入审计 · 服务器原始观测');
  let issuedEpoch=0,issuedController,issuedEpisode='',issuedPlayer='',issuedNext;
  const issuedControls=node('div','issued-controls'),issuedSelect=node('select'),issuedRefresh=node('button','button subtle','刷新最新'),issuedOlder=node('button','button subtle','更早记录'),issuedLive=node('input');
  issuedRefresh.onclick=()=>void loadIssued();issuedOlder.onclick=()=>{issuedLive.checked=false;void loadIssued(issuedNext);};issuedSelect.id='issued-player';issuedSelect.setAttribute('aria-label','选择观测席位');issuedSelect.onchange=()=>{issuedPlayer=issuedSelect.value;issuedList.replaceChildren();void loadIssued();};issuedLive.type='checkbox';issuedLive.id='issued-live';
  const liveLabel=node('label','','每 5 秒刷新最新');liveLabel.prepend(issuedLive);issuedControls.append(issuedSelect,issuedRefresh,issuedOlder,liveLabel);
  const issuedStatus=node('p','muted'),issuedList=node('div','issued-list');issuedStatus.id='issued-status';issuedList.id='issued-list';
  issuedDialog.content.append(node('p','','来自服务器保存的原始 observation，包含 view、updates、legalActions 和 control；不是由 state 重建，也不是 Agent 上传的 message。只隐藏行动凭证 decisionToken，JSON 排版已格式化。'),node('p','muted','签发记录不等于客户端已收到或模型已读到；相同响应命中缓存时复用记录，不统计每次网络发送。'),issuedControls,issuedStatus,issuedList);
  addButton('open-observations','输入审计',()=>showIssued());
  function showIssued(player){
    if(!state.rollout)return;issuedEpisode=state.rollout.summary.episodeId;issuedPlayer=player??state.rollout.players[0];issuedLive.checked=false;
    issuedSelect.replaceChildren(...state.rollout.players.map(p=>{const option=node('option','',p);option.value=p;return option;}));issuedSelect.value=issuedPlayer;
    issuedDialog.box.showModal();void loadIssued();
  }
  async function loadIssued(before){
    if(!issuedDialog.box.open||!state.token||issuedEpisode!==state.rollout?.summary.episodeId)return;
    issuedController?.abort();const requestEpoch=++issuedEpoch,session=state.session;issuedController=new AbortController();issuedNext=undefined;issuedOlder.disabled=true;issuedRefresh.disabled=true;issuedStatus.textContent='正在读取服务器签发记录…';
    if(!issuedLive.checked)issuedList.replaceChildren();
    try{
      const query=new URLSearchParams({playerId:issuedPlayer,limit:'10',...(before?{before}:{})});
      const data=await request(`/rollouts/${encodeURIComponent(issuedEpisode)}/observations?${query}`,undefined,{signal:issuedController.signal});
      if(requestEpoch!==issuedEpoch||session!==state.session||!issuedDialog.box.open)return;
      if(data.source!=='server-issued-observation'||!Array.isArray(data.observations))throw Error('原始观测格式不正确。');
      issuedNext=data.hasMore?data.nextBefore:undefined;issuedList.replaceChildren();issuedStatus.textContent=data.observations.length?`${issuedPlayer} · 本页 ${data.observations.length} 条 · 最新签发在前`:'本席尚无服务器签发记录。';
      for(const [i,record] of data.observations.entries()){const item=node('details','issued-record');item.open=i===0;const obs=record.observation;
        item.append(node('summary','',`${date(record.issuedAt,true)} · ${obs.status} · 历史游标 ${obs.updateCursor??'—'}`),node('p','muted',`observationId: ${record.observationId}`),node('pre','readable-original',JSON.stringify(obs,null,2)));issuedList.append(item);}
    }catch(error){if(requestEpoch===issuedEpoch&&session===state.session&&error.name!=='AbortError'){issuedList.replaceChildren();issuedStatus.textContent=error.status===404?'当前服务器尚未提供原始观测接口，需要更新后端。':`读取失败：${error.message}`;}}
    finally{if(requestEpoch===issuedEpoch){issuedRefresh.disabled=false;issuedOlder.disabled=!issuedNext;}}
  }
  issuedDialog.box.addEventListener('close',()=>{issuedController?.abort();issuedEpoch++;issuedLive.checked=false;issuedList.replaceChildren();});
  issuedLive.onchange=()=>{if(issuedLive.checked)void loadIssued();};
  setInterval(()=>{if(issuedLive.checked&&issuedDialog.box.open&&!issuedRefresh.disabled&&!document.hidden)void loadIssued();},5000);
  const streamDialog=dialog('agent-messages-dialog','输入审计 · 实际模型请求');
  let streamEpoch=0,streamController,streamEpisode='',streamPlayer='',streamAfter=-1,streamSeen=new Set(),streamBytes=0;
  const streamControls=node('div','issued-controls'),streamSelect=node('select'),streamRefresh=node('button','button subtle','读取后续输入'),streamLatest=node('button','button subtle','跳到最新'),streamArchive=node('button','button subtle','从头读取输入'),streamLive=node('input'),streamStatus=node('p','muted'),streamList=node('div','issued-list');
  streamSelect.id='monitor-player';streamSelect.setAttribute('aria-label','选择 Agent 席位');streamLive.type='checkbox';streamLive.id='monitor-live';streamStatus.id='monitor-status';streamList.id='monitor-messages';streamRefresh.id='monitor-refresh';streamLatest.id='monitor-latest';
  const streamLabel=node('label','','每 5 秒读取新消息');streamLabel.prepend(streamLive);streamControls.append(streamSelect,streamRefresh,streamLatest,streamArchive,streamLabel);
  streamDialog.content.append(node('p','','检查模型实际被提供了哪些信息：显示运行器上传的 model-input 原文，保留请求中的系统提示、消息历史、工具和观测等实际字段。与“服务器原始观测”对照，可定位漏发或转交时丢失的信息。'),node('p','muted','来源是运行器记录的请求，未上传时无法证明模型收到了什么。模型返回的 reasoning 和动作在决策回放中查看。分片保留原貌；窗口最多保留 100 条 / 2 MiB，服务器完整历史永久保存。'),streamControls,streamStatus,streamList);
  function clearStream(){streamController?.abort();streamEpoch++;streamSeen=new Set();streamBytes=0;streamAfter=-1;streamList.replaceChildren();streamStatus.textContent='';streamLive.checked=false;}
  function openStream(player){if(!state.rollout)return;clearStream();streamEpisode=state.rollout.summary.episodeId;streamPlayer=player??state.rollout.players[0];streamSelect.replaceChildren(...state.rollout.players.map(p=>{const option=node('option','',p);option.value=p;return option;}));streamSelect.value=streamPlayer;streamDialog.box.showModal();streamLive.checked=true;void readStream(true);}
  async function readStream(latest=false){
    if(!streamDialog.box.open||!state.token||streamEpisode!==state.rollout?.summary.episodeId)return;
    streamController?.abort();const serial=++streamEpoch,session=state.session,signal=(streamController=new AbortController()).signal;
    const valid=()=>serial===streamEpoch&&session===state.session&&streamDialog.box.open&&streamEpisode===state.rollout?.summary.episodeId;
    streamRefresh.disabled=true;streamLatest.disabled=true;streamStatus.textContent='正在读取原始消息…';
    try{
      if(latest){const summary=await request(`/rollouts/${encodeURIComponent(streamEpisode)}/messages`,undefined,{signal});if(!valid())return;const seat=summary.seats?.find(p=>p.playerId===streamPlayer);if(!Number.isSafeInteger(seat?.lastInputSequence))throw Error('当前后端尚未支持输入审计，请更新服务');streamAfter=Math.max(-1,seat.lastInputSequence-1);streamSeen=new Set();streamBytes=0;streamList.replaceChildren();}
      const query=new URLSearchParams({playerId:streamPlayer,after:String(streamAfter),limit:'25',kind:'model-input'});
      let data=await request(`/rollouts/${encodeURIComponent(streamEpisode)}/messages?${query}`,undefined,{signal});if(!valid())return;
      const first=data.messages?.[0],capture=first?.message?.capture;
      if(latest&&capture?.fragment===true&&Number.isSafeInteger(capture.index)&&capture.index>0&&capture.index<=first.sequence){streamAfter=first.sequence-capture.index-1;query.set('after',String(streamAfter));data=await request(`/rollouts/${encodeURIComponent(streamEpisode)}/messages?${query}`,undefined,{signal});if(!valid())return;}
      if(!Array.isArray(data.messages)||data.messages.some(record=>record.kind!=='model-input')||!Number.isSafeInteger(data.nextAfter)||data.nextAfter<streamAfter||data.hasMore&&data.nextAfter<=streamAfter)throw Error('模型输入分页格式无效。');
      for(const record of data.messages){if(streamSeen.has(record.sequence))continue;streamSeen.add(record.sequence);const item=lazyMessageDetails(`#${record.sequence} · ${record.kind??'message'} · ${date(record.serverReceivedAt??record.createdAt,true)}`,record);item.classList.add('issued-record');item.dataset.sequence=record.sequence;item.dataset.bytes=new TextEncoder().encode(JSON.stringify(record)).byteLength;streamBytes+=Number(item.dataset.bytes);streamList.prepend(item);}
      if(latest&&streamList.firstElementChild)streamList.firstElementChild.open=true;streamAfter=data.nextAfter;
      while(streamList.children.length>100||streamBytes>2*1024*1024&&streamList.children.length>1){const old=streamList.lastElementChild;streamBytes-=Number(old.dataset.bytes);streamSeen.delete(Number(old.dataset.sequence));old.remove();}
      streamStatus.textContent=`${streamPlayer} · ${streamList.children.length} 条已载入 · ${data.hasMore?'还有消息待读取，点击或等待下一次刷新':data.messages.length?'已读到当前最新上传记录':'暂无新消息'}${data.completion?' · 运行器已声明封存':''}`;
    }catch(error){if(valid()&&error.name!=='AbortError')streamStatus.textContent=`读取失败：${error.message}；已载入的原文仍保留。`;}
    finally{if(valid()){streamRefresh.disabled=false;streamLatest.disabled=false;}}
  }
  streamSelect.onchange=()=>{const live=streamLive.checked;clearStream();streamLive.checked=live;streamPlayer=streamSelect.value;void readStream(true);};streamRefresh.onclick=()=>void readStream();streamLatest.onclick=()=>void readStream(true);streamLive.onchange=()=>{if(streamLive.checked)void readStream();};
  streamArchive.onclick=()=>{clearStream();void readStream();};
  streamDialog.box.addEventListener('close',clearStream);
  setInterval(()=>{if(streamLive.checked&&streamDialog.box.open&&!streamRefresh.disabled&&!document.hidden)void readStream();},5000);
  const inputSources=(active,otherLabel,id,onClick)=>{const nav=node('nav','issued-controls');nav.setAttribute('aria-label','输入审计来源');const current=node('strong','',active),other=node('button','button subtle',otherLabel);other.id=id;other.onclick=onClick;nav.append(current,other);return nav;};
  issuedDialog.content.prepend(inputSources('服务器原始观测','实际模型请求 →','open-agent-messages',()=>{const player=issuedPlayer;issuedDialog.box.close();openStream(player);}));
  streamDialog.content.prepend(inputSources('实际模型请求','← 服务器原始观测','monitor-server-input',()=>{const player=streamPlayer;streamDialog.box.close();showIssued(player);}));
  document.querySelector('.top-actions').prepend(toolbar);
  const quickConnection=node('button','connection-quick');quickConnection.id='connection-quick-check';quickConnection.type='button';quickConnection.append(node('span','connection-light'));quickConnection.onclick=()=>void checkConnection(true);toolbar.prepend(quickConnection);
  const syncConnection=()=>{const phase=$('connection-status').dataset.state??'idle';quickConnection.className=`connection-quick ${phase}`;quickConnection.dataset.state=phase;quickConnection.disabled=$('check-connection').disabled;quickConnection.title=`${$('connection-status-label').textContent} · ${$('connection-reason').textContent} 点击检查连接`;
    quickConnection.setAttribute('aria-label',`${$('connection-status-label').textContent}，点击强制检查连接`);};
  new MutationObserver(syncConnection).observe($('connection-status'),{attributes:true,childList:true,subtree:true,characterData:true});syncConnection();
  const focus=node('section','focus-replay');focus.id='focus-replay';
  const shared=node('div','shared-board');shared.id='shared-board';
  const grid=node('div','player-grid');grid.id='player-grid';
  const chat=node('div','focus-communication');chat.id='focus-communication';
  focus.append(shared,grid,chat);detail.append(focus,timeline);
  const title=node('strong','focus-step-title');title.id='focus-step-title';title.hidden=true;timeline.prepend(title);
  const rail=node('div','timeline-track');rail.id='timeline-track';$('timeline').before(rail);rail.append($('event-strip'),$('timeline'));$('event-strip').setAttribute('aria-hidden','true');
  function positionTimelineNumbers(){
    const chips=[...$('event-strip').children],last=chips.length-1,stride=Math.max(1,Math.ceil(chips.length/Math.max(2,Math.floor(rail.clientWidth/36))));
    for(const [i,chip] of chips.entries()){chip.tabIndex=-1;chip.style.left=`${last?i/last*100:0}%`;chip.hidden=i!==state.index&&(Math.abs(i-state.index)<stride||i!==0&&i!==last&&i%stride!==0);}
    $('timeline').setAttribute('aria-valuetext',title.textContent);
  }
  new ResizeObserver(positionTimelineNumbers).observe(rail);
  const phase=node('span','focus-timing','手牌 / 可见信息：动作前');phase.id='focus-timing';document.querySelector('.episode-header-actions').prepend(phase);
  const recordingButton=node('button','button subtle recording-summary','轨迹待核对');recordingButton.id='recording-summary';recordingButton.type='button';recordingButton.onclick=()=>{showRecording();void loadRecording(true);};document.querySelector('.episode-header-actions').prepend(recordingButton);
  const more=node('button','button subtle','读取更多消息');more.id='focus-load-more';more.hidden=true;more.onclick=()=>load(true);evidence.content.prepend(more);

  function clear() {
    clearStream();if(streamDialog.box.open)streamDialog.box.close();streamEpisode='';
    issuedController?.abort();issuedEpoch++;if(issuedDialog.box.open)issuedDialog.box.close();issuedList.replaceChildren();issuedEpisode='';
    window.CoopLobby?.clear();
    controller?.abort();epoch++;episode='';seats={};busy=false;document.body.dataset.audit='false';
    recording=null;recordingError='';recordingBusy=false;recordingAt=0;recordingEpisode='';
    for(const box of [library.box,create.box,evidence.box,full.box,rules.box,recordingDialog.box])if(box.open)box.close();
    rules.content.replaceChildren();
    grid.replaceChildren();shared.replaceChildren();chat.replaceChildren();full.content.replaceChildren();more.hidden=true;
  }
  async function load(all=false,onlyPlayer) {
    const id=state.rollout?.summary.episodeId;if(!id||!state.token)return;
    void loadRecording();
    if(episode!==id){epoch++;episode=id;seats={};busy=false;}
    if(busy)return;busy=true;grid.dataset.messages='loading';const serial=epoch,session=state.session;
    controller=new AbortController();const signal=controller.signal;
    const valid=()=>epoch===serial&&session===state.session&&state.rollout?.summary.episodeId===id;
    // Bounded pages per click, streaming progress. Larger traces remain available
    // in the paginated original-message viewer rather than freezing the renderer.
    const selectedIndex=state.index,targets=R.snapshot(state.rollout,state.index).players;
    for(const {player,decision} of targets){
      if(onlyPlayer&&player!==onlyPlayer)continue;
      const seat=seats[player]??(seats[player]={messages:[],bytes:0,after:-1,more:true,error:'',loading:true});
      const available=()=>seat.blocks?.length>0;
      seat.loading=false;
      if(!seat.more||!all&&(seat.error||available()))continue;
      seat.loading=true;seat.error='';render();
      try{
        for(let page=0;page<5;page++){
          // Use a small initial burst, then refill at the server's read budget.
          // Only read seats needed at the selected step; never block the board.
          readCredits=Math.min(4,readCredits+(Date.now()-creditAt)/3100);creditAt=Date.now();
          if(readCredits<1){await new Promise(resolve=>setTimeout(resolve,(1-readCredits)*3100));readCredits=1;creditAt=Date.now();}
          if(!valid())return;readCredits--;
          const data=await request(`/rollouts/${encodeURIComponent(id)}/messages?playerId=${encodeURIComponent(player)}&after=${seat.after}&limit=100`,undefined,{signal});
          if(!valid())return;
          if(!Array.isArray(data.messages))throw Error('消息响应不完整');
          const next=data.nextAfter;
          if(data.hasMore&&(!Number.isInteger(next)||next<=seat.after))throw Error('消息分页游标未前进');
          const bytes=JSON.stringify(data.messages).length;

          seat.messages.push(...data.messages);seat.bytes+=bytes;seat.after=Number.isInteger(next)?next:seat.after;seat.more=!!data.hasMore;
          seat.completion=data.completion;seat.decoded=await CoopTrace.decode(seat.messages);if(!valid())return;seat.blocks=CoopTrace.blocks(seat.decoded);render();if(!seat.more||!all&&available())break;
        }
      }catch(error){if(valid())seat.error=error.status===429?'读取频率已达上限；稍后重试。':`轨迹读取失败：${error.message}`;}
      finally{if(valid()){seat.loading=false;render();}}
    }
    if(valid()){busy=false;grid.dataset.messages='ready';more.hidden=!Object.values(seats).some(s=>s.more||s.error);more.textContent=Object.values(seats).some(s=>s.error)?'重试读取消息':'读取更多消息';render();if(state.index!==selectedIndex)void load();}
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
      const hints=node('div',`hint-counter${view.hints===0?' exhausted':''}`);hints.id='hint-counter';
      hints.append(node('strong','',`剩余提示 ${view.hints} / 8`));
      const tokens=node('span','hint-tokens');tokens.setAttribute('aria-hidden','true');
      for(let i=0;i<8;i++)tokens.append(node('i',i<view.hints?'available':''));hints.append(tokens);
      hints.title='提示消耗 1 枚；弃牌或成功打出 5 恢复 1 枚，最多 8 枚。0 枚不能提示，8 枚不能弃牌。';
      shared.append(node('strong','',`${Object.values(view.fireworks).reduce((a,b)=>a+Number(b),0)} / 25`),hints,node('span','board-counts',`失误 ${view.errors} / 3 · 牌库 ${view.deckCount}`));
    }else if(state.rollout.summary.gameId==='take-time'){
      const slots=node('div','clock-overview');for(let n=1;n<=6;n++){const cards=(view.placements??[]).filter(p=>p.position===n);slots.append(node('span','',`${n}号位：${cards.length?cards.map(c=>c.value??'?').join(' + '):'空'}`));}shared.append(slots,node('span','',phaseNames[view.phase]??view.phase??''));
    }else{
      const keys=['phase','current','level','hints','lives','piles','stacks','trick','tasks','position','altitude','speed'];
      for(const k of keys.filter(k=>view[k]!==undefined).slice(0,5))shared.append(node('span','',`${labels[k]??k}：${compact(view[k])}`));
    }
    shared.append(button('展开棋盘',()=>{openEvidence();document.querySelector('.board-panel').scrollIntoView({block:'start'});}));
  }
  // Counts and completion declarations are small metadata. Do not download the
  // full message streams just to report whether each seat uploaded its trace.
  async function loadRecording(force=false) {
    const id=state.rollout?.summary.episodeId;if(!id||!state.token)return;
    if(recordingEpisode!==id){recordingEpisode=id;recording=null;recordingError='';recordingAt=0;recordingBusy=false;}
    if(recordingBusy||!force&&Date.now()-recordingAt<15000)return;
    recordingBusy=true;const session=state.session;renderRecording();
    try{
      const data=await request(`/rollouts/${encodeURIComponent(id)}/messages`);
      if(session!==state.session||state.rollout?.summary.episodeId!==id)return;
      if(!Array.isArray(data.seats))throw Error('Invalid recording summary');
      recording=data.seats;recordingError='';recordingAt=Date.now();
    }catch{if(session===state.session&&state.rollout?.summary.episodeId===id){recordingError='轨迹状态读取失败，点击重试。';recordingAt=Date.now();}}
    finally{if(session===state.session&&state.rollout?.summary.episodeId===id){recordingBusy=false;renderRecording();}}
  }
  function recordingLabel(seat) {
    if(!seat)return '尚未核对';
    if(!seat.messageCount)return '暂无模型 / 工具消息';
    if(!seat.completion)return '已收到消息 · 未封存';
    return seat.completion.completeness==='complete'?'已封存 · 声明完整':'已封存 · 部分记录';
  }
  function renderRecording() {
    const sealed=recording?.filter(s=>s.completion).length??0,total=state.rollout?.players.length??0;
    recordingButton.textContent=recordingError?'轨迹状态重试':recording?`轨迹 ${sealed}/${total} 席已封存`:recordingBusy?'核对轨迹…':'轨迹待核对';
    recordingButton.dataset.state=recordingError?'error':recording?.some(s=>!s.messageCount||!s.completion||s.completion.completeness!=='complete')?'partial':recording?'complete':'loading';
    recordingButton.title='封存与完整性由运行器声明，不代表全部内部思考可得。点击查看各席位收集范围。';
    if(recordingDialog.box.open)showRecording();
  }
  function showRecording() {
    const content=recordingDialog.content;content.replaceChildren(node('p','','服务端游戏事件与客户端模型消息分别保存。以下状态描述本局已上传的消息；完整性和推理可用性由运行器声明，不等于已核验全部内部思考。'));
    if(recordingError)content.append(node('p','notice error',recordingError));
    if(!recording)content.append(node('p','muted',recordingBusy?'正在读取各席位收集状态…':'尚未读取轨迹状态。'));
    for(const player of state.rollout?.players??[]){const seat=recording?.find(s=>s.playerId===player),completion=seat?.completion,section=node('section','recording-seat');section.dataset.player=player;
      section.append(node('h3','',`玩家 ${player.replace(/^p/,'')} · ${recordingLabel(seat)}`),node('p','',`服务器已收到 ${seat?.messageCount??0} 条消息`));
      if(completion){section.append(node('p','',`采集范围：${completion.scope}`),node('p','',`推理记录：${({'provided':'有返回的原文','summary-only':'仅摘要','not-provided':'未提供','redacted':'已隐藏'})[completion.reasoningAvailability]??'未声明'}`));
        if(completion.unavailable?.length)section.append(node('p','muted',`未采集：${completion.unavailable.join('；')}`));}
      content.append(section);
    }
    const retry=node('button','button subtle',recordingBusy?'正在刷新…':'刷新收集状态');retry.disabled=recordingBusy;retry.onclick=()=>void loadRecording(true);content.append(retry);
    if(!recordingDialog.box.open)recordingDialog.box.showModal();
  }
  function showRules() {
    rules.content.replaceChildren();
    const choices=node('select','rules-game-select');choices.id='rules-game-select';choices.setAttribute('aria-label','选择游戏规则');
    const games=[...state.games];const saved=state.rollout?.metadata;
    if(saved&&!games.some(g=>g.id===state.rollout.summary.gameId))games.unshift({...saved,id:state.rollout.summary.gameId});
    if(!games.length){rules.content.append(node('p','','连接服务器后可查看已支持游戏的规则。'));rules.box.showModal();return;}
    for(const game of games){const option=node('option','',game.name??game.id);option.value=game.id;choices.append(option);}
    choices.value=state.rollout?.summary.gameId??$('create-game').value??games[0].id;
    const body=node('div','readable-rules');rules.content.append(choices,body);
    const render=()=>{
      const game=choices.value===state.rollout?.summary.gameId&&saved?saved:games.find(g=>g.id===choices.value);if(!game)return;
      body.replaceChildren(node('h3','',game.name??choices.value));
      if(choices.value===state.rollout?.summary.gameId)body.append(node('p','muted','当前对局 · '+(state.rollout.summary.scenarioId??'')));
      const instructions=choices.value==='hanabi'?[
        '目标：合作将五种颜色各从 1 依次打到 5；各堆顶数字相加为得分，满分 25。',
        '看得见队友的牌，看不见自己的牌。2–3 人每人 5 张，4–5 人每人 4 张。自己的牌只保留收到的提示信息。',
        '轮到你时只做一件事：提示、打出一张牌，或弃掉一张牌。出牌 / 弃牌后有牌就补一张。',
        '提示标记全队共用：开始 8 枚，每次提示消耗 1 枚，0 枚时不能提示。弃牌或成功打出一张 5 恢复 1 枚，最多 8 枚；8 枚时不能弃牌。',
        '提示只能指定一位队友的一种颜色或一个数字，必须指出全部匹配的牌。本实现采用 2019 法文版，允许没有匹配牌的空提示。禁止额外聊天和重排手牌。',
        '错误出牌计 1 次失误，累计 3 次立即失败。牌库最后一张被抽走后，每人再行动一次，包括抽最后一张的人；提前完成 25 分则直接结束。'
      ]:game.rulesSummary??[];
      const list=node('ol');for(const text of instructions)list.append(node('li','',text));body.append(list);
      const implementation=game.implementation;
      if(implementation){const details=node('details','raw-details');details.append(node('summary','','实现范围与未覆盖内容'),structure(implementation));body.append(details);}
      if(game.scenarios?.length){const details=node('details','raw-details');details.append(node('summary','','可用场景 / 关卡'));for(const scenario of game.scenarios)details.append(node('p','',`${scenario.name}：${scenario.description??''}`));body.append(details);}
      body.append(node('h3','','规则来源'));
      for(const source of game.sources??[]){let url;try{url=new URL(source.url);if(url.protocol!=='https:'||url.username||url.password)continue;}catch{continue;}
        const row=node('p','rule-source',source.title??url.hostname);row.append(button('复制规则链接',()=>void transport.copyText(url.href).then(()=>message('已复制规则链接，可在浏览器查看原文。')).catch(error=>message(error.message,true))));body.append(row);
      }
    };choices.onchange=render;render();rules.box.showModal();
  }
  const traceLabels={observation:'本席观察',view:'可见局面',updates:'可见历史',legalActions:'合法动作',control:'时限与控制',rules:'游戏规则',action:'动作',decisionSummary:'提交理由',accepted:'是否接受',error:'错误',model:'模型',tools:'可用工具',parameters:'参数',required:'必填字段',properties:'字段',description:'说明',type:'类型',name:'名称',lastActionResult:'上次动作结果'};
  function traceValue(value){
    value=CoopTrace.parsed(value);
    if(value===null||typeof value!=='object')return node('p','trace-text',value===null?'空':String(value));
    const list=node('div','trace-fields'),entries=Object.entries(value);let offset=0;
    const more=node('button','text-button','显示更多字段');more.type='button';
    function append(){more.remove();for(const [key,item] of entries.slice(offset,offset+30)){
      if(item&&typeof item==='object'){
        const detail=node('details','trace-field'),title=node('summary','',`${traceLabels[key]??key}${Array.isArray(item)?' · '+item.length+' 项':''}`);detail.append(title);detail.addEventListener('toggle',()=>{if(detail.open&&!detail.dataset.loaded){detail.dataset.loaded='true';detail.append(traceValue(item));}});list.append(detail);
      }else{const row=node('div','trace-field');row.append(node('strong','',traceLabels[key]??key),traceValue(item));list.append(row);}
    }offset+=30;if(offset<entries.length)list.append(more);}
    more.onclick=append;append();return list;
  }
  function traceBlock(block,current=false){
    const category=CoopTrace.category(block),item=node('article',`trace-block trace-${block.type}${current?' trace-current':''}`);item.dataset.traceId=block.id;item.dataset.category=category;
    const detail=node('details','trace-detail'),head=node('summary','trace-block-head'),label=({input:block.type==='prompt'?'System':'User / System',output:'Assistant',reasoning:'Thinking',call:'Tool use',result:'Tool result',notice:'记录'})[category];
    head.append(node('strong','trace-kind',label));
    if(current)head.append(node('span','trace-current-label','本轮动作'));
    const at=node('time','',date(block.at,true).split(' ').at(-1));at.title=date(block.at,true);head.append(at,node('span','trace-disclosure','详情'));head.title=block.title;detail.append(head);
    detail.addEventListener('toggle',()=>{if(detail.open&&!detail.dataset.loaded){detail.dataset.loaded='true';const body=node('div','trace-expanded');body.append(node('p','trace-source',block.title));if(block.reason)body.append(node('p','trace-reason-full',block.reason));body.append(traceValue(block.value));if(block.confirmation){const f=block.confirmation;body.append(node('p','trace-source',`服务器确认 · 第 ${f.seq} 步`),traceValue({action:f.action,decisionSummary:f.decisionSummary??null}));}if(block.settings){const settings=node('details','trace-content');settings.append(node('summary','','模型设置与工具'),traceValue(block.settings));body.append(settings);}detail.append(body);}});
    const preview=node('p',`trace-preview thinking-excerpt${block.reason?' trace-reason':''}`,CoopTrace.preview(block));item.append(detail,preview);
    return item;
  }
  function renderPlayer(p,snap) {
    const actor=snap.actors.includes(p.player);
    const panel=node('article',`player-panel${actor?' acting':''}`);panel.dataset.player=p.player;
    const head=node('div','player-heading');head.append(node('h2','',`玩家 ${p.player.replace(/^p/,'')}`),node('span','player-turn',actor?(snap.live?'当前行动者':'本轮行动者'):'观察 / 等待'));panel.append(head);
    if(snap.live&&actor){const timer=node('span','replay-deadline');timer.dataset.player=p.player;head.append(timer);}
    const game=state.rollout.summary.gameId;
    const hand=node('section','player-hand'),handHead=node('div','compact-section-heading');handHead.append(node('h3','',game==='sky-team'?'骰子':game==='bomb-busters'?'电线':game==='magic-maze'?'行动能力':game==='hanabi'?'手牌与提示':'手牌'),node('span','audit-scope',game==='hanabi'?'牌面仅审计可见':'已记录信息'));hand.append(handHead);
    const backs=p.observation?.view?.cardBacks?.[p.player]?.hand;
    hand.append(cardRow(p.actual??(backs?.map(color=>({color}))),p.observation?'牌面未知 / 本游戏没有手牌':'历史视角缺失'));panel.append(hand);
    const visibility=node('section',`player-visibility${game==='hanabi'?' hanabi-knowledge':''}`),visibilityHead=node('div','compact-section-heading');visibilityHead.append(node('h3','',game==='hanabi'?'本人提示':'可见信息'));visibility.append(visibilityHead);
    if(state.rollout.summary.gameId==='hanabi'&&Array.isArray(p.hand)){
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
    visibilityHead.append(button('视角 ↗',()=>{full.content.replaceChildren(node('h3','',`${p.player} · ${p.exact?'本动作绑定的输入':'服务器投影；不代表 Agent 已读取'}`),node('pre','readable-original',JSON.stringify(p.observation,null,2)));full.box.showModal();}),button('签发原文 ↗',()=>showIssued(p.player)));panel.append(visibility);
    if(game==='hanabi'){handHead.append(...visibilityHead.querySelectorAll('button'));visibilityHead.remove();visibility.setAttribute('aria-label','本人已知提示');}
    const decision=node('section','player-decision'),status=seats[p.player];
    const recorded=status?.blocks??[],agent=recorded.some(b=>['prompt','input','output','reasoning','request'].includes(b.type));
    if(agent)panel.classList.add('agent-panel');
    const decisionHead=node('div','decision-heading');decisionHead.append(node('h3','',agent?'Agent 完整轨迹':'行动理由'),node('span','decision-step',agent?'本轮优先 · 最新在上':p.decision?`第 ${p.decision.seq} 步`:'尚未行动'));decision.append(decisionHead);
    if(agent){
      decisionHead.title='本席全局记录，包含行动理由与动作，独立于局面时间线';
      const list=node('div','trace-blocks');list.setAttribute('aria-label',`${p.player} 完整轨迹`);list.dataset.player=p.player;
      const blocks=CoopTrace.withFrames(recorded,state.rollout.frames.filter(f=>f.playerId===p.player&&f.action)).sort((a,b)=>(typeof b.at==='number'?b.at:Date.parse(b.at)||0)-(typeof a.at==='number'?a.at:Date.parse(a.at)||0)||b.sequence-a.sequence);
      const limit=status.displayLimit??80;
      const current=CoopTrace.currentCallId(recorded,{frame:snap.frame?.playerId===p.player?snap.frame:null,live:snap.live,observation:p.observation});
      const selectedBlock=blocks.find(b=>b.id===current),displayed=selectedBlock?[selectedBlock,...blocks.filter(b=>b!==selectedBlock).slice(0,limit-1)]:blocks.slice(0,limit);
      if(current&&status.highlightedId!==current)list.dataset.revealCurrent='true';status.highlightedId=current;
      status.nodes??=new Map();
      for(const block of displayed){const signature=JSON.stringify(block);let saved=status.nodes.get(block.id);if(saved?.signature!==signature){saved={signature,item:traceBlock(block,block.id===current)};status.nodes.set(block.id,saved);}const selected=block.id===current;saved.item.classList.toggle('trace-current',selected);let badge=saved.item.querySelector('.trace-current-label');if(selected&&!badge){badge=node('span','trace-current-label','本轮动作');saved.item.querySelector('.trace-kind').after(badge);}if(!selected)badge?.remove();list.append(saved.item);}
      if(blocks.length>limit)list.append(button(`展开更早的 ${Math.min(80,blocks.length-limit)} 个记录块`,()=>{status.displayLimit=limit+80;render();}));
      decision.append(list);
    }else{
      decision.append(node('p','thinking-excerpt',p.decision?.decisionSummary??(p.decision?.automatic?'服务器超时默认动作':p.decision?'本步未填写理由。':'尚未提交动作。')));
    }
    if(status?.error||status?.loading||agent)decision.append(node('span','trace-status',status.error|| (status.loading?'正在读取轨迹…':`已载入 ${status.messages.length} 条记录${status.more?' · 还有记录待读取':' · 已读到当前末尾'}`)));
    if(status?.more||status?.error)decision.append(button(status.error?'重试读取轨迹':'继续读取完整轨迹',()=>void load(true,p.player)));
    panel.append(decision);
    if(agent)return panel;
    const action=node('section',`player-action${p.decision?.error?' rejected-action':''}`);action.append(node('span','action-label',p.decisionIndex===state.index?'做了什么':'上次做了什么'),node('strong','action-description',p.decision?R.actionText(p.decision):'等待行动'));
    if(p.decision?.error)action.append(node('span','','服务器拒绝，未生效'));
    panel.append(action);return panel;
  }
  function render() {
    if(!state.rollout)return;document.body.dataset.audit='true';const snap=R.snapshot(state.rollout,state.index);

    $('open-create').hidden=!['operator','member'].includes(state.identity?.role);
    setText('focus-timing',snap.live?'实时局面 · 当前待行动':snap.frame?.action?'手牌 / 可见信息：动作前':'手牌 / 可见信息：此时点');
    setText('focus-step-title',snap.live?`实时局面 · ${snap.actors.length?`等待 ${snap.actors.join(' / ')} 行动`:'等待进展'} · 最近记录 #${snap.frame?.seq??0}`:`${snap.frame?.seq===0?'初始局面':`第 ${snap.frame?.seq??0} 步`} · ${snap.frame?.playerId??'系统'} · ${R.actionText(snap.frame)}`);
    const scrolls=new Map([...grid.querySelectorAll('.trace-blocks')].map(el=>[el.dataset.player,el.scrollTop]));grid.dataset.count=String(snap.players.length);grid.replaceChildren(...snap.players.map(p=>renderPlayer(p,snap)));renderShared(snap);for(const el of grid.querySelectorAll('.trace-blocks'))el.scrollTop=el.dataset.revealCurrent?0:scrolls.get(el.dataset.player)??0;
    const communications=state.rollout.frames.slice(0,state.index+1).map(f=>({frame:f,text:publicCommunication(f)})).filter(m=>m.text);
    const last=communications.at(-1);chat.replaceChildren(node('strong','','公开交流'),node('span','chat-preview',last?`${last.frame.playerId} · ${last.text}`:'截至这一步还没有公开交流。'));
    const communicationButton=button(`交流 ${communications.length} ↗`,()=>{openEvidence();$('communication-panel').scrollIntoView({block:'start'});});communicationButton.title=last?`${last.frame.playerId} · ${last.text}`:'尚无公开交流';shared.append(communicationButton);
    positionTimelineNumbers();
    updateCountdowns();
  }
  function updateCountdowns(){
    if(!state.rollout||document.body.dataset.view!=='replay')return;
    const snap=R.snapshot(state.rollout,state.index),offset=state.replayClock?.session===state.session?state.replayClock.offset:0;
    for(const timer of grid.querySelectorAll('.replay-deadline')){
      const remaining=snap.live?R.remainingMs(snap.views[timer.dataset.player],Date.now()+offset):null;
      timer.hidden=remaining===null;
      if(remaining!==null){const seconds=Math.ceil(remaining/1000);timer.textContent=seconds?`${Math.floor(seconds/60)}:${String(seconds%60).padStart(2,'0')}`:'等待服务器更新';timer.dataset.expired=String(seconds===0);timer.setAttribute('aria-label',seconds?`本轮剩余 ${seconds} 秒`:'本轮已到时，等待服务器更新');}
    }
  }
  setInterval(updateCountdowns,250);
  let liveBusy=false;
  const liveButton=addButton('replay-refresh','刷新进展',()=>void refreshReplay(true));
  async function refreshReplay(manual=false){
    if(liveBusy||!state.rollout||document.body.dataset.view!=='replay'||document.hidden||!manual&&state.rollout.summary.status!=='active')return;
    const id=state.rollout.summary.episodeId,session=state.session,serial=state.detailRequest;liveBusy=true;liveButton.disabled=true;
    try{
      const data=await request(`/rollouts/${encodeURIComponent(id)}`);
      if(session!==state.session||serial!==state.detailRequest||state.rollout?.summary.episodeId!==id)return;
      const follow=state.index===state.rollout.frames.length-1;state.rollout=data;if(follow)state.index=Math.max(0,data.frames.length-1);
      renderHeader();renderTimeline();renderFrame();
      for(const seat of Object.values(seats)){seat.more=true;seat.error='';}
      await load(true);
      liveButton.textContent=data.summary.status==='active'?'实时更新中 · 刷新':'刷新进展';
    }catch(error){liveButton.textContent='刷新失败 · 重试';}
    finally{liveBusy=false;liveButton.disabled=false;}
  }
  setInterval(()=>void refreshReplay(),5000);
  window.CoopFocus={clear,load,render,openMessages:openStream,selected(){clearStream();if(streamDialog.box.open)streamDialog.box.close();issuedController?.abort();issuedEpoch++;if(issuedDialog.box.open)issuedDialog.box.close();controller?.abort();epoch++;episode='';seats={};busy=false;if(library.box.open)library.box.close();if(full.box.open)full.box.close();if(evidence.box.open)evidence.box.close();full.content.replaceChildren();}};
  window.addEventListener('keydown',event=>{
    if(!state.rollout||document.querySelector('dialog[open]')||['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement?.tagName))return;
    if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();stopPlayback();selectFrame(state.index+(event.key==='ArrowRight'?1:-1));}
  });
  if(state.rollout){render();void load();}
})();
