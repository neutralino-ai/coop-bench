// Trusted courier only: records/transmits exact agent replies; never chooses a move.
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const root=resolve(import.meta.dirname,'..'),folder=join(root,'artifacts/cloud-private/hanabi-demo');
function file(name,text){const path=join(folder,name);if(existsSync(path)){if(readFileSync(path,'utf8')!==text)throw Error('Immutable relay file conflict');}else writeFileSync(path,text,{flag:'wx',mode:0o600});return path;}
function call(...args){const result=spawnSync(process.execPath,[join(root,'scripts/hanabi-demo.mjs'),...args],{cwd:root,encoding:'utf8',windowsHide:true,maxBuffer:16*1024*1024,timeout:120000});if(result.error||result.status!==0)throw Error(`Relay stage ${args[0]} failed: ${result.stderr||'see preserved data'}`);return JSON.parse(result.stdout);}
function next(turn,player){
  const observation=call('prepare',player);
  if(observation.status!=='active'||observation.view.current!==player)throw Error('Not this player turn');
  // Full current legal seat view; past public events are included without
  // repeating whole hand snapshots and action examples from every update.
  const view=structuredClone(observation.view);
  view.hands=Object.fromEntries(Object.entries(view.hands).map(([id,hand])=>[id,hand.map(slot=>[slot.index,slot.id,slot.color??null,slot.value??null,
    slot.possibleColors.length===5?'*':slot.possibleColors.join('|'),slot.possibleValues.length===5?'*':slot.possibleValues.join('')])]));
  const prompt='GAME_TURN\n'+JSON.stringify({handColumns:['index','id','color','value','possibleColors','possibleValues'],legend:'null=未显示；候选颜色以|分隔，候选数字逐位列出；*=全部五色或1至5。无信息删减。',playerId:observation.playerId,observationId:observation.observationId,view,
    publicEventsSincePreviousTurn:(observation.updates??[]).map(update=>update.view.lastEvent).filter(Boolean),
    availableActionTypes:observation.legalActions.map(action=>action.type)});
  const path=file(`turn-${String(turn).padStart(3,'0')}-${player}-input.txt`,prompt);
  call('record-input',player,path);return {turn,player,prompt};
}
const [mode,n,player,encoded]=process.argv.slice(2);
if(mode==='ready'){
  const path=file('ready.json','{"ready":true}');for(const id of ['p1','p2','p3'])call('record-output',id,path);console.log('{"readyRecorded":3}');
}else{
  const turn=Number(n);if(!Number.isInteger(turn)||turn<1||turn>150||!['p1','p2','p3'].includes(player))throw Error('Invalid turn');
  if(mode==='next')console.log(JSON.stringify(next(turn,player)));
  else if(mode==='step'){
    const raw=decodeURIComponent(encoded),path=file(`turn-${String(turn).padStart(3,'0')}-${player}-output.json`,raw);
    const result=call('act',player,path);if(!result.accepted)throw Error('Agent action rejected; inspect original reply');
    console.log(JSON.stringify({result,...(result.status==='active'?next(turn+1,result.nextPlayer):{done:true})}));
  }else throw Error('Usage: ready | next TURN PLAYER | step TURN PLAYER URL_ENCODED_ORIGINAL_REPLY');
}
