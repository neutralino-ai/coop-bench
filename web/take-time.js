/* Rendering only: numbered rules and action choices come from the own-seat API.
 * This module is shared by Player and recorded replay; it never reads final
 * state, another seat's view, or a local game engine. */
(() => {
  const el=(tag,text='',cls='')=>{const n=document.createElement(tag);n.textContent=text;if(cls)n.className=cls;return n;};
  const color=c=>c==='solar'?'☀ 太阳':'☾ 月亮';
  const phase={discussion:'讨论 · 看牌后禁言',playing:'沉默放牌',finished:'已结算'};
  const button=(text,click)=>{const b=el('button',text);b.type='button';b.onclick=click;return b;};
  function renderBoard(host,view,{observation=null,onAction=null,canAct=()=>false,playerName=id=>id,compact=false}={}) {
    host.replaceChildren();host.classList.add('tt-board');
    const actions=observation?.legalActions??[],c=view.clock??{},rules=view.rules?.clock;
    const root=el('div','','tt-content'),status=el('div','','tt-status');
    status.append(el('strong',c.name??rules?.title??'时序谜局'),el('span',phase[view.phase]??view.phase),el('span',`明牌余 ${view.faceUpRemaining??'—'}`));
    if(view.deckCount)status.append(el('span',`牌库 ${view.deckCount}`));root.append(status);
    const own=new Map((view.ownPlacements??[]).map(p=>[p.turn,p.card?.value??p.value]));
    const clock=el('div','','tt-clock');clock.setAttribute('aria-label','顺时针六个位置');
    const spots=c.angle===0?[[2,1],[3,1],[3,3],[2,3],[1,3],[1,1]]:[[3,1],[3,2],[3,3],[1,3],[1,2],[1,1]];
    const center=el('div','','tt-center');center.append(el('strong',`起点 ${c.start??1}`));
    if(c.firstStart)center.append(el('span',`首牌起点 ${c.firstStart}`));
    if(c.secondHand)center.append(el('span',`秒针禁放 ${c.secondHand} / ${(c.secondHand+2)%6+1}`));
    if(c.rotation)center.append(el('span',`钟盘顺转 ${c.rotation} 格`));
    center.append(el('small','位置固定 · 顺时针编号'));clock.append(center);
    const positions=[];
    for(let n=1;n<=6;n++){
      const slot=el('section','','tt-slot');slot.dataset.position=String(n);slot.style.gridColumn=String(spots[n-1][0]);slot.style.gridRow=String(spots[n-1][1]);
      const info=c.positions?.find(p=>p.position===n),head=el('div','','tt-slot-head');head.append(el('strong',`${n} 号位${n===(c.start??1)?' ▸':''}`));
      if(info?.sector!==undefined&&info.sector!==n)head.append(el('small',`扇区 ${info.sector}`));slot.append(head);
      const conditions=info?.conditions??(n===1?['恰好 1 张太阳牌']:n===6?['恰好 3 张']:[]);
      for(const text of conditions)slot.append(el('div',text,'tt-condition'));
      const cards=el('div','','tt-placed');let known=0,unknown=0;
      for(const p of (view.placements??[]).filter(p=>p.position===n)){
        const value=p.value??(p.playerId===view.playerId?own.get(p.turn):null);
        if(typeof value==='number')known+=value;else unknown++;
        const card=el('span',`${p.color==='solar'?'☀':'☾'} ${value??'?'}${p.faceUp?' ◉':''}`,`tt-chip ${p.color==='solar'?'solar':'lunar'}`);
        card.title=`第 ${p.turn} 张 · ${playerName(p.playerId)} · ${p.faceUp?'明置':value==null?'暗置':'本人已知'}`;cards.append(card);
      }
      if(!cards.children.length)cards.append(el('small','空位'));slot.append(cards);
      slot.append(el('small',unknown?`已知 ${known} + ${unknown} 张暗牌`:`总和 ${known}`,'tt-sum'));
      positions.push(slot);clock.append(slot);
    }
    root.append(clock);
    if(!compact){
      const seats=el('div','','tt-seats');
      for(const id of [...(view.playerIds??Object.keys(view.cardBacks??{}))].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}))){
        const row=el('div','','tt-seat'+(view.activePlayerIds?.includes(id)?' active':'')+(id===view.playerId?' own':''));row.dataset.player=id;
        const counts=view.cardColorCounts?.[id]?.hand,backs=view.cardBacks?.[id]?.hand??[];
        row.append(el('strong',`${playerName(id)}${id===view.playerId?'（我）':''}`),el('span',`☀ ${counts?.solar??backs.filter(c=>c==='solar').length} · ☾ ${counts?.lunar??backs.filter(c=>c==='lunar').length}`),el('span',view.lookedPlayerIds?.includes(id)?'已看牌 · 禁言':'未看牌'));
        if(view.reserveCounts?.[id])row.append(el('small',`保留 ${view.reserveCounts[id]} 张`));seats.append(row);
      }root.append(seats);
      const hand=el('div','','tt-hand');hand.setAttribute('aria-label','本人手牌');
      if(view.hand===null)hand.append(el('p','尚未查看牌面，可先讨论。'));
      else if(!view.hand?.length)hand.append(el('p','手牌已空'));
      let selected=null,destination=null;
      const place=actions.find(a=>a.type==='place'),pass=actions.find(a=>a.type==='pass_card'),received=actions.find(a=>a.type==='place_passed');
      const choices=place??pass??received,examples=choices?.examples??[];
      const controls=el('div','','tt-controls'),faceLabel=el('label','','tt-face-label'),face=el('input');face.type='checkbox';face.setAttribute('aria-label','明置牌面');
      faceLabel.append(face,el('span','明置牌面（消耗 1 次）'));face.disabled=!(view.faceUpRemaining>0)||Boolean(received);
      const preview=el('p','先选一张牌，再选位置。','tt-preview');preview.setAttribute('role','status');
      const reason=el('textarea');reason.maxLength=1200;reason.rows=2;reason.placeholder='只说明本席可见信息下的选择（可选）';reason.setAttribute('aria-label','本次理由');
      const sendAction=action=>onAction?.(action,reason.value.trim()||undefined);
      const confirm=button('确认放置',()=>{const action=intent();if(action&&canAct()&&examples.some(a=>sameAction(a,action)))sendAction(action);});confirm.className='tt-confirm';
      function intent(){return received&&destination?{type:'place_passed',position:destination}:pass&&selected?{type:'pass_card',cardId:selected,faceUp:face.checked}:place&&selected&&destination?{type:'place',cardId:selected,position:destination,faceUp:face.checked}:null;}
      function sync(){
        for(const b of hand.querySelectorAll('button')){b.disabled=!canAct()||!examples.some(a=>a.cardId===b.dataset.card);b.setAttribute('aria-pressed',String(selected===b.dataset.card));}
        for(const slot of positions){const n=Number(slot.dataset.position),b=slot.querySelector('button');if(!b)continue;
          b.disabled=!canAct()||!examples.some(a=>a.position===n&&(!selected||a.cardId===undefined||a.cardId===selected));b.setAttribute('aria-pressed',String(destination===n));}
        const action=intent();confirm.disabled=!canAct()||!action||!examples.some(a=>sameAction(a,action));
        const card=view.hand?.find(c=>c.id===selected);
        preview.textContent=received?`收到${color(view.pendingCard?.color)} ${view.pendingCard?.value??'暗牌'}${destination?` → ${destination} 号位`:'，请选择位置'}`:card?`${color(card.color)} ${card.value} · ${face.checked?'明置':'暗置'}${pass?' → 交给下一席':destination?` → ${destination} 号位`:' · 请选择位置'}`:'先选一张牌，再选位置。';
      }
      for(const [i,card] of (view.hand??[]).entries()){
        const b=button(`${color(card.color)} ${card.value}`,()=>{selected=card.id;sync();});b.className=`tt-card ${card.color==='solar'?'solar':'lunar'}`;b.dataset.card=card.id;b.title=`第 ${i+1} 张`;b.setAttribute('aria-label',`第 ${i+1} 张 ${color(card.color)} ${card.value}`);hand.append(b);
      }
      if(onAction){
        for(const slot of positions){const n=Number(slot.dataset.position);if(place||received){const b=button(`放到 ${n}`,()=>{destination=n;sync();});b.className='tt-destination';slot.append(b);}}
        if(choices){if(!received)controls.append(faceLabel);confirm.textContent=pass?'确认交牌':'确认放置';controls.append(preview,confirm);}
        for(const action of actions.filter(a=>['look_hand','choose_start','speak'].includes(a.type))){
          if(action.type==='look_hand'){const b=button('查看我的牌 · 开始禁言',()=>{if(canAct())sendAction({type:'look_hand'});});b.className='tt-look';controls.append(b);}
          if(action.type==='speak'){const form=el('form','','tt-discuss-form'),input=el('textarea');input.maxLength=2000;input.required=true;input.rows=2;input.placeholder='看牌前公开讨论…';input.setAttribute('aria-label','公开讨论');const send=el('button','发送');send.type='submit';form.append(input,send);form.onsubmit=event=>{event.preventDefault();if(canAct()&&input.value.trim())sendAction({type:'speak',text:input.value.trim()});};controls.append(form);}
          if(action.type==='choose_start'){const form=el('form','','tt-pointer-form'),fields=[];
            for(const key of Object.keys(action.schema.properties).filter(k=>k!=='type')){const label=el('label',key==='position'?'总和起点':'秒针起点'),select=el('select');for(let n=1;n<=6;n++){const option=el('option',`${n} 号位`);option.value=String(n);select.append(option);}select.value=String(key==='position'?c.start:c.secondHand);label.append(select);fields.push([key,select]);form.append(label);}
            const send=el('button','设置指针');send.type='submit';form.append(send);form.onsubmit=event=>{event.preventDefault();if(canAct())sendAction({type:'choose_start',...Object.fromEntries(fields.map(([key,input])=>[key,Number(input.value)]))});};controls.append(form);}
        }
        if(actions.length){const detail=el('details','','tt-reason');detail.append(el('summary','本次理由（可选 · 仅审计可见）'),reason);controls.append(detail);}
      }
      // Keep selecting and confirming a card visible above the clock on phones.
      face.onchange=sync;root.insertBefore(hand,clock);root.insertBefore(controls,clock);
      const refresh=()=>{sync();for(const input of controls.querySelectorAll('textarea,select,button:not(.tt-confirm)'))input.disabled=!canAct();face.disabled=!canAct()||!(view.faceUpRemaining>0)||Boolean(received);};
      host.ttRefresh=refresh;refresh();
      if(view.discussion?.length){const discussion=el('details','','tt-discussion');discussion.open=view.phase==='discussion';discussion.append(el('summary',`公开讨论 · ${view.discussion.length} 条`));const list=el('div','','tt-discussion-list');for(const m of view.discussion)list.append(el('p',`${playerName(m.playerId)}：${m.text}`));discussion.append(list);root.append(discussion);}
    }
    if(view.result){const result=el('details','','tt-result');result.open=true;result.append(el('summary',view.result.won?'✓ 全部条件满足':'未通过 · 查看结算条件'),el('p',`总和：${view.result.sums?.join(' / ')}${view.result.start?` · 结算起点 ${view.result.start}`:''}`));
      if(view.result.values&&rules?.metric==='difference')result.append(el('p',`差值：${view.result.values.join(' / ')}`));
      if(view.result.firstValues&&c.firstStart)result.append(el('p',`首牌：${view.result.firstValues.join(' / ')}`));
      for(const text of view.result.violations??[])result.append(el('p',`× ${text}`));root.append(result);}
    if(!compact&&rules?.conditions){const detail=el('details','','tt-rules');detail.append(el('summary','本关完整规则'));for(const text of rules.conditions)detail.append(el('p',text));for(const text of view.rules?.instructions??[])detail.append(el('p',text));root.append(detail);}
    host.append(root);
  }
  function sameAction(a,b){return Object.keys(b).every(k=>(a[k]??(k==='faceUp'?false:undefined))===b[k]);}
  function renderOptions(host,game){host.replaceChildren();host.hidden=!game?.setupSchema;if(host.hidden)return;
    const props=game.setupSchema.properties,bonus=el('label','失败奖励标记'),select=el('select');select.dataset.option='bonusTokens';for(let n=props.bonusTokens.minimum;n<=props.bonusTokens.maximum;n++){const o=el('option',String(n));o.value=String(n);select.append(o);}bonus.append(select);host.append(bonus);
    const advanced=el('details','','tt-rebirth');advanced.append(el('summary',props.rebirth.title));for(const option of props.rebirth.options){const label=el('label','','tt-modifier'),input=el('input');input.type='checkbox';input.value=option.id;input.dataset.option='rebirth';label.append(input,el('span',option.name));label.title=option.description;advanced.append(label);}
    const label=el('label','自选秒针起点'),second=el('select');second.dataset.option='secondHandStart';for(let n=1;n<=6;n++){const o=el('option',`${n} 号位`);o.value=String(n);second.append(o);}label.append(second);advanced.append(label);host.append(advanced);
  }
  function readOptions(host){if(!host||host.hidden)return undefined;const rebirth=[...host.querySelectorAll('input[data-option=rebirth]:checked')].map(n=>n.value);return {bonusTokens:Number(host.querySelector('[data-option=bonusTokens]').value),rebirth,...(rebirth.includes('second-hand')?{secondHandStart:Number(host.querySelector('[data-option=secondHandStart]').value)}:{})};}
  window.CoopTakeTime={renderBoard,renderOptions,readOptions};
})();
