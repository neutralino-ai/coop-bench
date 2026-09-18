/* Human audit helpers. Input is recorded projections, never the live engine or
 * terminal state. This module is not part of the player/agent interface. */
globalThis.CoopReplay = (() => {
  const colors = {white:'白',red:'红',blue:'蓝',yellow:'黄',green:'绿',solar:'☀',lunar:'☾',pink:'粉',rocket:'火箭',submarine:'潜艇'};
  const color = value => colors[value] ?? value ?? '?';
  const cardText = card => typeof card !== 'object' || card === null ? String(card ?? '?') : `${color(card.color ?? card.suit)} ${card.value ?? card.rank ?? '?'}`;
  function snapshot(rollout, index) {
    const frame = rollout.frames[index];
    // An action's pre-state is the preceding recorded frame, including rejected
    // actions. Do not use its post-state (draws/reveals can disclose new cards).
    const source = frame?.action ? rollout.frames[index - 1] : frame;
    const views = source?.views ?? {};
    return {frame, source, views, players: rollout.players.map(player => {
      const exact = frame?.playerId === player && frame?.action ? frame.observed : null;
      const observation = exact ?? views[player] ?? null;
      const view = observation?.view;
      const hand = view && Object.hasOwn(view,'hand') ? view.hand : view?.hands?.[player] ?? view?.myDice ?? (view?.stands
        ? view.stands.filter(s => s.owner === player).flatMap(s => s.wires) : undefined)
        ?? view?.permissions?.[player]?.map(value => ({value:({N:'↑',S:'↓',E:'→',W:'←',explore:'探索',teleport:'传送',escalator:'扶梯'})[value] ?? value}));
      let actual = hand;
      if (rollout.summary.gameId === 'hanabi' && Array.isArray(hand)) {
        // Join only by stable card identity at this same pre-state. A stale bound
        // observation with different card IDs must not inherit newly drawn cards.
        actual = hand.map(card => {
          if (card.color !== undefined && card.value !== undefined) return card;
          const candidates = Object.entries(views).filter(([seat]) => seat !== player)
            .map(([, envelope]) => envelope.view?.hands?.[player]?.find(c => c.id && c.id === card.id))
            .filter(c => c?.color !== undefined && c.value !== undefined);
          const first = candidates[0];
          return first && candidates.every(c => c.color === first.color && c.value === first.value) ? first : card;
        });
      }
      let decisionIndex = index;
      while (decisionIndex >= 0 && !(rollout.frames[decisionIndex].playerId === player && rollout.frames[decisionIndex].action)) decisionIndex--;
      return {player, observation, exact: !!exact, hand, actual,
        decision: decisionIndex >= 0 ? rollout.frames[decisionIndex] : null, decisionIndex};
    })};
  }
  function actionText(frame) {
    const a = frame?.action;
    if (!a) return ({created:'发牌 / 初始状态',truncated:'结束记录'})[frame?.kind] ?? '系统事件';
    const saved = frame.observed?.view?.hand?.find(c => c.id === a.cardId);
    const played = saved ? cardText(saved) : cardText(a.card ?? a.cardId ?? a.value ?? '');
    const slot = Number.isInteger(a.index) ? `第 ${a.index + 1} 张牌` : played;
    switch (a.type) {
      case 'play': return `打出${slot}`;
      case 'discard': return `弃掉${slot}`;
      case 'hint': return `提示 ${a.target}：${a.kind === 'color' ? color(a.value) + '色' : '数字 ' + a.value}`;
      case 'speak': case 'message': case 'chat': return `说：“${a.text ?? a.message ?? ''}”`;
      case 'place': return `将 ${played} 放到 ${a.position} 号位${a.faceUp ? '（明置）' : '（暗置）'}`;
      case 'look_hand': return '查看自己的手牌';
      case 'communicate': return `沟通：${cardText(a.card)} · ${a.position ?? a.mode ?? ''}`;
      default: return `${a.type} · ${Object.entries(a).filter(([key]) => key !== 'type').map(([key,value]) => `${key}=${typeof value === 'object' ? JSON.stringify(value) : value}`).join('，')}`;
    }
  }
  function linkedMessages(messages, frame, player) {
    const id = frame?.observed?.observationId;
    if (!id) return [];
    // Timestamps/request proximity are not evidence of belonging to a decision.
    return messages.filter(m => m.playerId === player && m.observationId === id).sort((a,b) => a.sequence - b.sequence);
  }
  function textBlocks(value) {
    if (typeof value === 'string') return value;
    if (Array.isArray(value)) return value.map(textBlocks).filter(Boolean).join('\n');
    if (!value || typeof value !== 'object' || ['redacted_thinking','encrypted'].includes(value.type)) return '';
    return typeof value.text === 'string' ? value.text : typeof value.thinking === 'string' ? value.thinking : '';
  }
  function reasoning(messages) {
    const sections = [];
    for (const entry of messages) {
      // Never treat model-input/user messages containing quoted reasoning as the
      // model's actual output, and never decode encrypted/redacted fields.
      if (entry.kind && entry.kind !== 'model-output') continue;
      const root = entry.message;
      if (!root || root.role && root.role !== 'assistant') continue;
      const inspect = m => {
        if (!m || m.role && m.role !== 'assistant') return;
        for (const key of ['reasoning_content','reasoning']) {
          const text = textBlocks(m[key]);
          if (text) sections.push({label:entry.reasoningAvailability === 'summary-only' ? '上传的推理摘要' : '上传的 reasoning 原文', text});
        }
        for (const b of Array.isArray(m.content) ? m.content : []) if (['thinking','reasoning','reasoning_text'].includes(b?.type)) {
          const text = textBlocks(b); if (text) sections.push({label:'上传的 thinking 原文',text});
        }
        for (const b of Array.isArray(m.output) ? m.output : []) if (b?.type === 'reasoning') {
          const text = textBlocks(b.summary); if (text) sections.push({label:'上传的推理摘要',text});
        }
      };
      inspect(root); inspect(root.raw);
      for (const c of root.raw?.choices ?? root.choices ?? []) inspect(c.message);
    }
    return sections.filter((s,i) => sections.findIndex(other => other.text === s.text && other.label === s.label) === i);
  }
  return Object.freeze({snapshot, actionText, linkedMessages, reasoning, color, cardText});
})();
