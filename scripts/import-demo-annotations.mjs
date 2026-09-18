import {readFileSync,existsSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join,resolve} from 'node:path';
const root=fileURLToPath(new URL('../',import.meta.url)),data=join(root,'data','local-server');
const dir=resolve(process.argv[2]??join(root,'artifacts','http-agent-demo-2026-09-17'));
const info=JSON.parse(readFileSync(join(data,'connection.json'),'utf8'));
const token=readFileSync(join(data,'coordinator-token'),'utf8').trim();
const meta=JSON.parse(readFileSync(join(dir,'episode.json'),'utf8'));
async function call(path,body){
  const r=await fetch(info.apiUrl+path,{method:body?'POST':'GET',headers:{Authorization:`Bearer ${token}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{}),signal:AbortSignal.timeout(15000)});
  const value=await r.json();if(!r.ok)throw Error(JSON.stringify(value));return value;
}
const path=`/rollouts/${meta.episodeId}`,rollout=await call(path);
if(rollout.summary.status==='active')throw Error('Import post-game notes only after termination.');
const inputs=[];
for(const playerId of ['p1','p2','p3']){
  const file=join(dir,playerId,'reflection.md');if(existsSync(file))inputs.push({kind:'reflection',playerId,text:`【协调者导入先前 ${playerId} 的赛后反思文件；不是本次座位 API 提交】\n\n${readFileSync(file,'utf8').trim()}`});
}
for(const name of ['review.md','independent-review.md']){
  const file=join(dir,name);if(existsSync(file))inputs.push({kind:'review',text:`【协调者导入先前审计：${name}】\n\n${readFileSync(file,'utf8').trim()}`});
}
let added=0;
for(const input of inputs){
  if(rollout.annotations.some(a=>a.kind===input.kind&&a.playerId===(input.playerId??null)&&a.text===input.text))continue;
  rollout.annotations.push(await call(`${path}/annotations`,input));added++;
}
console.log(JSON.stringify({episodeId:meta.episodeId,added,totalAnnotations:rollout.annotations.length}));
