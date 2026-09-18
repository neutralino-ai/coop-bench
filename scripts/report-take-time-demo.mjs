import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
const directory=resolve(process.argv[2]??'artifacts/http-agent-demo-2026-09-17');
const read=name=>JSON.parse(readFileSync(join(directory,name),'utf8'));
const audit=read('audit.json'),training=read('training.json'),replay=read('replay.json');
if(audit.gameId!=='take-time'||audit.status!=='completed')throw Error('This report requires a completed Take Time episode.');
// Old engine builds may have stored a safe outcome receipt without adapter details.
// The terminal Take Time observation already contains the revealed result; never
// replay the current engine to manufacture historical evidence.
if(!audit.outcome?.details){
  const terminal=[...audit.issuedObservations].reverse().find(o=>o.payload.status==='completed'&&o.payload.view?.result);
  if(!terminal)throw Error('No recorded terminal Take Time result is available.');
  audit.outcome={...audit.outcome,details:terminal.payload.view.result};
}
const observations=new Map(audit.issuedObservations.map(o=>[o.id,o.payload]));
const events=audit.events.filter(e=>e.kind==='accepted');
const time=value=>new Date(value).toLocaleString('zh-CN',{timeZone:'Asia/Shanghai',hour12:false});
const esc=value=>String(value??'').replaceAll('|','\\|').replaceAll('\n',' ');
const color=value=>value==='solar'?'太阳':'月亮';
const card=value=>`${color(value.color)} ${value.value}`;
const rows=events.map(e=>({event:e,command:e.payload.command,observation:observations.get(e.payload.command.observationId)}));
const speeches=rows.filter(r=>r.command.action.type==='speak');
const looks=rows.filter(r=>r.command.action.type==='look_hand');
const plays=rows.filter(r=>r.command.action.type==='place');
const privacyFailures=[];
for(const o of audit.issuedObservations){
  const v=o.payload.view;
  if(v.phase==='finished')continue;
  for(const p of v.placements??[])if(!p.faceUp&&p.value!==null)privacyFailures.push(`Observation ${o.id}: hidden placement value`);
  if(!v.lookedPlayerIds.includes(v.playerId)&&v.hand!==null)privacyFailures.push(`Observation ${o.id}: hand before looking`);
}
const evidence={
  episodeId:audit.episodeId,scope:audit.options.scenarioId,
  acceptedActions:events.length,rejectedActions:audit.events.filter(e=>e.kind==='rejected').length,
  discussionMessages:speeches.length,lookActions:looks.length,placements:plays.length,
  faceUpCount:plays.filter(r=>r.command.action.faceUp).length,
  allSpeechBeforeOwnLook:speeches.every(r=>!r.observation.view.lookedPlayerIds.includes(r.event.player_id)),
  allDecisionsHaveOwnObservation:rows.every(r=>r.observation?.playerId===r.event.player_id),
  allDecisionsHaveSummary:rows.every(r=>typeof r.command.decisionSummary==='string'&&r.command.decisionSummary.length>0),
  privacyFailures,replayValid:replay.valid,success:audit.outcome.success,sums:audit.outcome.details.sums,
  terminalTeamReward:training.terminalTeamReward,trainingRows:training.rows.length,
};
writeFileSync(join(directory,'evidence-checks.json'),JSON.stringify(evidence,null,2));
const lines=[
  '# 三个子智能体经 localhost API 试玩 Take Time 1-1',
  '',`- 对局：\`${audit.episodeId}\`。`,
  '- 范围：官方 Chapter 1, Clock 1（第 1 章第 1 个时钟）；bonusTokens=0。',
  '- 方法：三个新建子智能体上下文，独立座位凭证，HTTP 工具调用，一次未筛选的随机发牌。',
  '- 调度：两轮讨论、每人每轮一句；全部看牌后 p1→p2→p3 循环。这是演示安排，不是官方发言上限。',
  '- 信息隔离：每位玩家按协议只读取自己的座位文件和 API 观察。共享 OS 账号不构成恶意代码沙箱。',
  '- 时间均为 Asia/Shanghai；原始 JSON 保留服务端 UTC 时间。',
  '', '## 结果', '',
  `**${audit.outcome.success?'团队获胜':'团队失败'}**。六格总和：**${audit.outcome.details.sums.join('，')}**。`,
  '',`- 终局说明：${esc(audit.outcome.reason)}`,
  `- 放牌 ${plays.length} 次，其中明置 ${evidence.faceUpCount} 张；最多允许 3 张，也可以全部暗置。`,
  `- 自动重放：${replay.valid?'通过':'失败'}；${replay.acceptedActions} 个动作逐步核对状态哈希。`,
  `- 训练导出：${training.rows.length} 条动作，终局团队奖励 ${training.terminalTeamReward}。`,
  '- 单次演示不构成胜率估计；成功轨迹也需要质量筛选，失败轨迹可用于诊断和 RL 数据。',
  '', '## 看牌前讨论原文', '', '| 时间 | 玩家 | 公开发言 |', '|---|---|---|',
  ...speeches.map(r=>`| ${time(r.event.received_at)} | ${r.event.player_id} | ${esc(r.command.action.text)} |`),
  '', '## 看牌时刻', '', '| 时间 | 玩家 |', '|---|---|',
  ...looks.map(r=>`| ${time(r.event.received_at)} | ${r.event.player_id} |`),
  '', '## 每次放牌与当时提供的简短理由', '',
  '本表中的暗置数值在终局后整理。牌局中其他玩家看不到这些数值。理由是玩家主动提交的简述，不是隐藏思维链。', '',
  '| 次序 | 时间 | 玩家 | 牌 | 位置 | 放置方式 | 决策简述 |', '|---:|---|---|---|---:|---|---|',
  ...plays.map((r,index)=>{const a=r.command.action,c=r.observation.view.hand.find(c=>c.id===a.cardId);return `| ${index+1} | ${time(r.event.received_at)} | ${r.event.player_id} | ${card(c)} | ${a.position} | ${a.faceUp?'明置':'暗置'} | ${esc(r.command.decisionSummary)} |`;}),
  '', '## 决策时的信息边界', '',
  '完整的本人手牌、此前公开动作和本人已出牌可在 training.json 中按 action 查阅。其他人的暗置牌值在终局前应为 null；颜色和落点公开，明置牌值公开。', '',
  '| 次序 | 玩家 | 当时自己的剩余手牌 | 此前公开明置信息 | 此前未公开数值的牌数 |', '|---:|---|---|---|---:|',
  ...plays.map((r,index)=>{const v=r.observation.view;return `| ${index+1} | ${r.event.player_id} | ${v.hand.map(card).join('、')} | ${v.placements.filter(p=>p.faceUp).map(p=>`第${p.turn}手 ${p.playerId} ${color(p.color)} ${p.value}→格${p.position}`).join('；')||'无'} | ${v.placements.filter(p=>!p.faceUp).length} |`;}),
  '', '## 证据检查', '',
  `- 所有 ${events.length} 个接受动作都引用了本人的服务端观察：${evidence.allDecisionsHaveOwnObservation}。`,
  `- 所有公开发言都发生在本人看牌之前：${evidence.allSpeechBeforeOwnLook}。`,
  `- 所有动作都有简短决策说明：${evidence.allDecisionsHaveSummary}。`,
  `- 终局前的牌值可见性检查：${privacyFailures.length===0?'通过':privacyFailures.join('; ')}。`,
  `- 被拒绝的动作数：${evidence.rejectedActions}。`,
  '- 以上证明接口和记录的行为；不证明 OS 级隔离，也不把服务器已发出的观察等同于客户端确实阅读了每个字段。',
  '', '## 玩家赛后反思', '',
];
for(const id of ['p1','p2','p3']){const file=join(directory,id,'reflection.md');lines.push(`### ${id}`,'',existsSync(file)?readFileSync(file,'utf8').trim():'待玩家提交。','');}
const review=join(directory,'review.md');if(existsSync(review))lines.push('## 协调者审计与反思','',readFileSync(review,'utf8').trim(),'');
lines.push('## 原始证据','','- [完整审计](audit.json)','- [逐玩家训练轨迹](training.json)','- [重放结果](replay.json)','- [证据检查](evidence-checks.json)','- [服务接口检查](server-checks.json)');
if(existsSync(join(directory,'independent-review.md')))lines.push('- [独立子智能体复核](independent-review.md)');
writeFileSync(join(directory,'report.md'),lines.join('\n')+'\n');
console.log(JSON.stringify(evidence,null,2));
