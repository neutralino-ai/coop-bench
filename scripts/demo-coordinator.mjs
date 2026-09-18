import {readFileSync,writeFileSync,mkdirSync,existsSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const [mode,directory]=process.argv.slice(2);
if(!['create','export'].includes(mode)||!directory)throw Error('Usage: node scripts/demo-coordinator.mjs create|export OUTPUT_DIRECTORY');
const root=fileURLToPath(new URL('../',import.meta.url)),data=join(root,'data','local-server'),out=resolve(directory);
const connection=JSON.parse(readFileSync(join(data,'connection.json'),'utf8'));
const token=readFileSync(join(data,'coordinator-token'),'utf8').trim();
async function call(path,body){const response=await fetch(connection.apiUrl+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});const value=await response.json();if(!response.ok)throw Error(JSON.stringify(value));return value;}
mkdirSync(out,{recursive:true});
if(mode==='create'){
  if(existsSync(join(out,'episode.json')))throw Error('This output directory already contains an episode. Choose a new directory; do not overwrite player credentials or evidence.');
  const episode=await call('/episodes',{gameId:'take-time',scenarioId:'official-clock-1-1',playerCount:3,config:{bonusTokens:0}});
  writeFileSync(join(out,'episode.json'),JSON.stringify({episodeId:episode.episodeId,gameId:episode.gameId,scenarioId:episode.scenarioId,createdAt:new Date().toISOString(),method:'three-fresh-subagents-http',selection:'one unselected random deal'},null,2));
  for(const seat of episode.seats){const folder=join(out,seat.playerId);mkdirSync(folder,{recursive:true});writeFileSync(join(folder,'seat.json'),JSON.stringify({baseUrl:connection.apiUrl,episodeId:episode.episodeId,gameId:episode.gameId,playerId:seat.playerId,seatToken:seat.token},null,2),{mode:0o600});}
  console.log(JSON.stringify({episodeId:episode.episodeId,players:episode.seats.map(s=>({playerId:s.playerId,seatFile:join(out,s.playerId,'seat.json')}))},null,2));
}else{
  const meta=JSON.parse(readFileSync(join(out,'episode.json'),'utf8'));
  for(const kind of ['audit','training','replay']){const result=await call(`/episodes/${meta.episodeId}/${kind}`);writeFileSync(join(out,`${kind}.json`),JSON.stringify(result,null,2));if(kind==='replay')console.log(JSON.stringify(result));}
  console.log(`Exported audit, training and replay to ${out}`);
}
