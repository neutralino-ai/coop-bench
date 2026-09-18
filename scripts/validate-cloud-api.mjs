import {spawn} from 'node:child_process';
import {createServer as createTcpServer} from 'node:net';
import {request} from 'node:http';
import {existsSync,mkdirSync,readFileSync,renameSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import {join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {mechanicalPolicy,mechanicalScheduler} from '../src/local-runner.ts';

// This validation is intentionally pinned to the user's authorized cloud host.
// It never connects to the desktop server at local port 8788.
const root=fileURLToPath(new URL('../',import.meta.url));
const privateDir=join(root,'artifacts','cloud-private');
const stateFile=join(privateDir,'cloud-api-smoke-state.json');
const reportDir=join(root,'artifacts','security-2026-09-17');
const reportFile=join(reportDir,'cloud-api-validation.json');
const token=readFileSync(join(privateDir,'owner.txt'),'utf8').trim();
if(!/^[A-Za-z0-9._~-]{24,256}$/.test(token))throw Error('Expected a raw individual operator token in the local private file.');
mkdirSync(reportDir,{recursive:true});
let state=existsSync(stateFile)?JSON.parse(readFileSync(stateFile,'utf8')):null;
const report={schemaVersion:'coop-cloud-api-validation-v1',target:'ubuntu@62.234.160.98',startedAt:new Date().toISOString(),
  purpose:'deployment-mechanical-smoke-and-bounded-access-validation',policy:'mechanical-first-legal-example; not LLM evaluation',
  network:'temporary strict-host-key SSH loopback forward to remote 127.0.0.1:8788',checks:[],allPassed:false};
const saveState=()=>{const temporary=stateFile+'.tmp';writeFileSync(temporary,JSON.stringify(state,null,2),{mode:0o600});renameSync(temporary,stateFile);};
const record=(name,actual,expected)=>{const passed=actual===expected;report.checks.push({name,actual,expected,passed});if(!passed)throw Error(`Validation failed: ${name}.`);};
const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function available(port){
  return new Promise(resolve=>{const server=createTcpServer();server.once('error',()=>resolve(false));server.listen(port,'127.0.0.1',()=>server.close(()=>resolve(true)));});
}
let port;
for(const candidate of [18788,18089])if(await available(candidate)){port=candidate;break;}
if(!port)throw Error('Both dedicated validation ports are occupied.');
const tunnel=spawn('ssh',['-N','-o','BatchMode=yes','-o','ConnectTimeout=10','-o','StrictHostKeyChecking=yes',
  '-o','ExitOnForwardFailure=yes','-o','ServerAliveInterval=15','-o','ServerAliveCountMax=2',
  '-L',`127.0.0.1:${port}:127.0.0.1:8788`,'ubuntu@62.234.160.98'],{windowsHide:true,stdio:['ignore','ignore','pipe']});
let tunnelFailed=false;tunnel.on('error',()=>{tunnelFailed=true;});tunnel.stderr.on('data',()=>{});
const base=`http://127.0.0.1:${port}`;
async function call(path,{credential,body,headers={},key}={}){
  return new Promise((resolve,reject)=>{
    const req=request(base+path,{method:body===undefined?'GET':'POST',headers:{Host:'127.0.0.1:8788',
      ...(credential?{Authorization:`Bearer ${credential}`} : {}),...(body===undefined?{}:{'Content-Type':'application/json'}),
      ...(key?{'Idempotency-Key':key}:{}),...headers}},res=>{
      const chunks=[];let size=0;
      res.on('data',chunk=>{size+=chunk.length;if(size>8*1024*1024)req.destroy(Error('Response exceeded validation budget.'));else chunks.push(chunk);});
      res.on('error',()=>reject(Error('Cloud HTTP response failed.')));
      res.on('end',()=>{try{resolve({status:res.statusCode,body:JSON.parse(Buffer.concat(chunks).toString('utf8'))});}catch{reject(Error('Cloud returned invalid JSON.'));}});
    });
    req.on('error',()=>reject(Error('Cloud tunnel HTTP request failed.')));req.setTimeout(10000,()=>req.destroy());
    req.end(body===undefined?undefined:JSON.stringify(body));
  });
}
const observation=async seat=>{
  const response=await call(`/api/v1/episodes/${state.episodeId}/observation`,{credential:seat.token});
  if(response.status!==200)throw Error('Own-seat observation failed.');
  if(response.body.playerId!==seat.playerId)throw Error('Server returned a different player identity.');
  return response.body;
};
async function flushPending(){
  if(!state.pending)return;
  const pending=state.pending,seat=state.seats.find(s=>s.playerId===pending.playerId);
  const response=await call(`/api/v1/episodes/${state.episodeId}/actions`,{credential:seat.token,body:pending.command,key:pending.key});
  if(response.status!==pending.expectedStatus)throw Error(`Pending ${pending.kind} request returned unexpected status ${response.status}.`);
  if(pending.kind==='mechanical'){
    if(response.body.accepted!==true)throw Error('Mechanical action was not accepted.');
    state.actions.push({playerId:seat.playerId,type:pending.command.action.type,key:pending.key});
    if(!state.idempotencyChecked){
      const retry=await call(`/api/v1/episodes/${state.episodeId}/actions`,{credential:seat.token,body:pending.command,key:pending.key});
      if(retry.status!==response.status||JSON.stringify(retry.body)!==JSON.stringify(response.body))throw Error('Idempotent retry changed its receipt.');
      state.idempotencyChecked=true;
    }
    state.previousPlayerId=seat.playerId;
  }else if(pending.kind==='seat-swap')state.seatSwapChecked=true;
  state.pending=null;saveState();
}

try{
  let health;
  for(let attempt=0;attempt<25;attempt++){
    if(tunnelFailed||tunnel.exitCode!==null)throw Error('Strict SSH tunnel could not start.');
    try{health=await call('/api/v1/health');break;}catch{await pause(300);}
  }
  if(!health)throw Error('Cloud API did not respond through the dedicated SSH tunnel.');
  record('health',health.status,200);report.build=health.body.build;
  record('foreign-host-blocked',(await call('/api/v1/health',{headers:{Host:'attacker.invalid'}})).status,403);
  record('foreign-origin-blocked',(await call('/api/v1/health',{headers:{Origin:'https://attacker.invalid'}})).status,403);
  record('anonymous-audit-blocked',(await call('/api/v1/rollouts')).status,401);
  const identity=await call('/api/v1/identity',{credential:token});
  record('individual-operator-authenticated',identity.status,200);record('operator-role',identity.body.role,'operator');
  if(state?.phase==='creation-pending')throw Error('Previous creation outcome is uncertain; inspect cloud episode list before authorizing a replacement.');
  if(!state){
    state={phase:'creation-pending',purpose:report.purpose,createdAt:new Date().toISOString(),actions:[],pending:null};saveState();
    const created=await call('/api/v1/episodes',{credential:token,body:{gameId:'take-time',playerCount:3,scenarioId:'official-clock-1-1'}});
    record('single-mechanical-episode-created',created.status,201);
    state={...state,...created.body,phase:'playing',previousPlayerId:null};saveState();
  }
  report.episodeId=state.episodeId;
  const [first,second]=state.seats;
  record('anonymous-seat-observation-blocked',(await call(`/api/v1/episodes/${state.episodeId}/observation`)).status,401);
  record('seat-cannot-read-full-rollout',(await call(`/api/v1/rollouts/${state.episodeId}`,{credential:first.token})).status,401);
  record('seat-cannot-cross-episode',(await call(`/api/v1/episodes/${randomUUID()}/observation`,{credential:first.token})).status,401);
  await flushPending();
  let current=await observation(first);
  if(current.status==='active'&&!state.seatSwapChecked){
    const other=await observation(second);
    state.pending={kind:'seat-swap',playerId:first.playerId,key:'cloud-smoke-seat-swap',expectedStatus:409,
      command:{observationId:other.observationId,decisionToken:other.decisionToken,action:{type:'look_hand'},
        decisionSummary:'Deployment security probe: a different seat observation must be rejected.'}};saveState();
    await flushPending();
    const own=await observation(first);record('seat-swap-does-not-reveal-hand',own.view.hand===null,true);
  }
  while(current.status==='active'&&state.actions.length<49){
    const observations=await Promise.all(state.seats.map(observation));
    current=observations[0];if(current.status!=='active')break;
    const playerId=mechanicalScheduler({activePlayerIds:state.seats.map(s=>s.playerId),previousPlayerId:state.previousPlayerId,
      candidates:observations.map(o=>({playerId:o.playerId,actionTypes:o.legalActions.map(a=>a.type)}))});
    if(!playerId)throw Error('Mechanical policy has no progress action; episode is preserved for inspection.');
    const own=observations.find(o=>o.playerId===playerId);
    const action=await mechanicalPolicy({gameId:'take-time',scenarioId:'official-clock-1-1',playerId,
      observation:own.view,observationHistory:own.updates.map(u=>u.view),legalActions:own.legalActions});
    if(!action)throw Error('Mechanical policy declined its legal menu.');
    state.pending={kind:'mechanical',playerId,key:`cloud-smoke-move-${state.actions.length+1}`,expectedStatus:200,
      command:{observationId:own.observationId,decisionToken:own.decisionToken,action,
        decisionSummary:'Deployment mechanical smoke: choose the first progress example from this seat legal menu.'}};saveState();
    await flushPending();current=await observation(first);
  }
  record('episode-completed-within-50-commands',current.status,'completed');
  record('idempotent-receipt',state.idempotencyChecked,true);
  if(state.seatSwapChecked)record('cross-seat-action-rejected',true,true);
  const reviewText='Deployment mechanical smoke and bounded authorization check, 2026-09-17. Three scripted seats used only their own API observations and the mechanical first-legal-example policy. No LLM agents or human reasoning were evaluated. One deliberately swapped-seat command was rejected. This rollout is infrastructure validation and must be excluded from agent capability evaluations.';
  const rollout=await call(`/api/v1/rollouts/${state.episodeId}`,{credential:token});record('terminal-rollout-readable',rollout.status,200);
  if(!rollout.body.annotations.some(note=>note.text===reviewText)){
    const annotated=await call(`/api/v1/rollouts/${state.episodeId}/annotations`,{credential:token,body:{kind:'review',text:reviewText}});
    record('mechanical-smoke-labelled',annotated.status,201);
  }else record('mechanical-smoke-labelled',true,true);
  const replay=await call(`/api/v1/episodes/${state.episodeId}/replay`,{credential:token});
  record('replay-readable',replay.status,200);record('deterministic-replay-valid',replay.body.valid,true);
  const audit=await call(`/api/v1/episodes/${state.episodeId}/audit`,{credential:token});record('terminal-audit-readable',audit.status,200);
  const training=await call(`/api/v1/episodes/${state.episodeId}/training`,{credential:token});record('training-export-readable',training.status,200);
  report.acceptedActions=state.actions.length;report.deliberatelyRejectedActions=state.seatSwapChecked?1:0;
  report.outcome=current.outcome;report.trainingRows=training.body.rows.length;report.eventCount=audit.body.events.length;
  report.actionTypes=state.actions.reduce((counts,a)=>(counts[a.type]=(counts[a.type]??0)+1,counts),{});
  report.replay=replay.body;report.allPassed=true;state.phase='completed';saveState();
}catch(error){
  report.error=error instanceof Error?error.message:'Cloud validation failed.';process.exitCode=1;
}finally{
  if(tunnel.exitCode===null){tunnel.kill();await Promise.race([new Promise(resolve=>tunnel.once('exit',resolve)),pause(3000)]);}
  report.tunnelClosed=tunnel.exitCode!==null||tunnel.signalCode!==null;
  report.finishedAt=new Date().toISOString();writeFileSync(reportFile,JSON.stringify(report,null,2));
  // The report contains no credentials, commands, private observations or hands.
  console.log(JSON.stringify(report,null,2));
}
