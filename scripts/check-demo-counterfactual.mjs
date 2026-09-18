// Post-game analysis only. Does not alter the HTTP episode or training export.
import {readFileSync,writeFileSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {takeTime} from '../src/games/take-time.ts';
const dir=resolve(process.argv[2]??'artifacts/http-agent-demo-2026-09-17');
const audit=JSON.parse(readFileSync(join(dir,'audit.json'),'utf8'));
if(audit.gameId!=='take-time'||audit.status!=='completed')throw Error('Requires completed Take Time audit.');
const actions=audit.events.filter(e=>e.kind==='accepted').map(e=>({playerId:e.player_id,action:structuredClone(e.payload.command.action)}));
const p2=actions.filter(e=>e.playerId==='p2'&&e.action.type==='place');
if(p2.length!==4)throw Error('Expected four p2 placements.');
const swap=[p2[2].action.cardId,p2[3].action.cardId];
p2[2].action.cardId=swap[1];p2[3].action.cardId=swap[0];
let state=takeTime.setup(audit.options);
for(const step of actions)state=takeTime.step(state,step.playerId,step.action);
const outcome=takeTime.outcome(state);
const report={type:'post-hoc-fixed-other-actions',episodeId:audit.episodeId,
  description:'Swap only p2 third/fourth placed cards; retain all destinations, face-up flags, and other recorded actions.',
  limitation:'Uses the complete terminated audit and holds other players actions fixed. It does not establish how other agents would actually respond or the hidden-information policy win rate.',
  original:{success:audit.outcome.success,sums:audit.outcome.details.sums},
  counterfactual:{success:outcome.success,sums:outcome.details.sums},actions};
writeFileSync(join(dir,'counterfactual.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({original:report.original,counterfactual:report.counterfactual},null,2));
