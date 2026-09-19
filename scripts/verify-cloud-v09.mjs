// Real HTTPS deployment acceptance, only on the new 34936 endpoint.
// Creates explicitly labelled deterministic fixtures; these are NOT LLM results.
import assert from 'node:assert/strict';
import {isDeepStrictEqual} from 'node:util';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {RemoteSession} from '../desktop/remote-session.mjs';
import {createAgentMessageRecorder} from './agent-message-recorder.mjs';
import {uploadAgentArtifact} from './upload-agent-artifact.mjs';
const base='https://coop.neutrinophysics.cn:34936/api/v1',oldBase='https://coop.neutrinophysics.cn:34935/api/v1';
const owner=readFileSync(new URL('../artifacts/cloud-private/owner.txt',import.meta.url),'utf8').trim();
assert.match(owner,/^[A-Za-z0-9._~+/-]{24,256}=*$/);
mkdirSync('artifacts/cloud-v09',{recursive:true});
const report={at:new Date().toISOString(),base,network:'ordinary public HTTPS; certificate verification enabled',fixture:'deterministic infrastructure acceptance, no model or LLM reasoning',checks:[]};
const tokens=[],recorders=[],controllers=[];let episodeId,timeoutEpisode,session;
const check=(name,condition)=>{report.checks.push({name,passed:!!condition});assert.ok(condition,name);};
async function call(path,token=owner,data,key,expected=200,api=base){
 await delay(140);
 for(let attempt=0;attempt<3;attempt++){
  const response=await fetch(api+path,{method:data===undefined?'GET':'POST',redirect:'error',signal:AbortSignal.timeout(55000),headers:{...(token?{Authorization:`Bearer ${token}`} :{}),...(data===undefined?{}:{'Content-Type':'application/json'}),...(key?{'Idempotency-Key':key}:{})},...(data===undefined?{}:{body:JSON.stringify(data)})});
  if(response.status===429&&data===undefined&&attempt<2){await response.body?.cancel();await delay(5000);continue;}
  check(`${data===undefined?'GET':'POST'} ${path.split('?')[0]} status ${expected}`,response.status===expected);
  return response.headers.get('content-type')?.includes('json')?response.json():Buffer.from(await response.arrayBuffer());
 }
}
async function recordView(i,obs){await recorders[i].recordToolResult({tool:'observation',observation:obs},{observationId:obs.observationId});}
async function act(i,obs){
 const requestId=randomUUID(),action=obs.legalActions.find(a=>a.type==='play')?.examples[0];assert.ok(action,'Expected a legal play');
 const payload={observationId:obs.observationId,decisionToken:obs.decisionToken,action};
 await recorders[i].recordToolCall({tool:'act',requestId,payload},{observationId:obs.observationId,requestId});
 const result=await call(`/episodes/${episodeId}/actions`,tokens[i],payload,requestId);
 await recorders[i].recordToolResult({tool:'act',requestId,result},{observationId:obs.observationId,requestId});
 check('legal deterministic action accepted',result.accepted===true);return {payload,requestId,result};
}
try{
 const oldBefore=await call('/rollouts?limit=1',owner,undefined,undefined,200,oldBase);report.oldEpisodesBefore=oldBefore.total;
 const health=await call('/health','');report.build=health.build;check('new build differs from old service',(await call('/health','',undefined,undefined,200,oldBase)).build!==health.build);
 check('ten registered games',(await call('/games','')).games.length===10);
 session=new RemoteSession({fetcher:fetch,store:{load:()=>({apiUrl:base}),save(){}}});
 const connected=await session.connect({apiUrl:base,token:owner,remember:false});check('desktop transport connects as owner',connected.connected&&connected.identity.id==='owner');
 const account=await call('/auth/account');check('existing owner password remains configured',account.passwordConfigured===true);
 await call('/identity','',undefined,undefined,401);await call('/identity','synthetic-invalid-'+randomUUID(),undefined,undefined,401);
 const initial=await call('/rollouts?limit=1');report.newEpisodesBefore=initial.total;
 const room=await call('/rooms',owner,{gameId:'hanabi',playerCount:3,scenarioId:'base'},undefined,201);report.roomId=room.roomId;
 for(let i=0;i<3;i++){
  tokens.push(randomBytes(32).toString('base64url'));
  const joined=await call(`/rooms/${room.roomId}/join`,room.inviteToken,{name:`Deployment fixture ${i+1} (no LLM)`,playerToken:tokens[i]});check('separate seat assigned',joined.playerId===`p${i+1}`);
 }
 const roster=await call(`/rooms/${room.roomId}`,tokens[0]);
 for(let i=0;i<3;i++)await call(`/rooms/${room.roomId}/ready`,tokens[i],{rosterVersion:roster.rosterVersion,ready:true});
 await call(`/rooms/${room.roomId}/start`,tokens[1],{},undefined,403);
 const started=await call(`/rooms/${room.roomId}/start`,tokens[0],{});episodeId=started.episodeId;report.episodeId=episodeId;
 for(let i=0;i<3;i++)recorders.push(await createAgentMessageRecorder({baseUrl:base,episodeId,seatToken:tokens[i],outboxFile:`artifacts/cloud-v09/deployment-seat-${i+1}-${episodeId}.jsonl`,scope:'Actual recorded seat observations and action calls/results from a deterministic deployment fixture; no model was invoked.'}));
 const views=[];
 for(let i=0;i<3;i++){
  const rules=await call(`/episodes/${episodeId}/rules`,tokens[i]);check('seat can pull Hanabi rules',rules.gameId==='hanabi');
  const obs=await call(`/episodes/${episodeId}/observation`,tokens[i]);views.push(obs);await recordView(i,obs);
  check('own Hanabi ranks hidden',obs.view.hands[obs.playerId].every(card=>card.value===undefined));
 }
 await call(`/episodes/${episodeId}/audit`,tokens[0],undefined,undefined,401);
 const deadline=views[0].control.deadlineAt;check('required action window is at most 60 seconds',deadline>Date.now()&&deadline-Date.now()<=60000);
 // A second fixture demonstrates the real server deadline independently.
 const timeout=await call('/episodes',owner,{gameId:'hanabi',playerCount:2,scenarioId:'base'},undefined,201);timeoutEpisode=timeout.episodeId;report.timeoutEpisodeId=timeoutEpisode;
 const timeoutSeat=timeout.seats[0].token??timeout.seats[0].seatToken;
 const timeoutView=await call(`/episodes/${timeoutEpisode}/observation`,timeoutSeat);const timeoutAt=timeoutView.control.deadlineAt;
 // Verify SSE reaches a reader immediately through Nginx, without buffering.
 const sseAbort=new AbortController();controllers.push(sseAbort);
 const stream=await fetch(`${base}/episodes/${episodeId}/events?after=0`,{headers:{Authorization:`Bearer ${tokens[2]}`},signal:sseAbort.signal});
 check('SSE endpoint works',stream.status===200&&stream.headers.get('content-type').startsWith('text/event-stream'));
 const reader=stream.body.getReader();let firstEvent='';
 const timer=setTimeout(()=>sseAbort.abort(),10000);
 try{while(!firstEvent.includes('\n\n')){const part=await reader.read();if(part.done)break;firstEvent+=new TextDecoder().decode(part.value);}check('SSE observation is streamed',firstEvent.includes('event: observation'));}finally{clearTimeout(timer);sseAbort.abort();await reader.cancel().catch(()=>{});}
 // Deliberately exceed the legacy proxy's 30-second timeout; new proxy allows65.
 const waitedAt=Date.now(),waiting=call(`/episodes/${episodeId}/wait?after=${views[1].nextCursor??views[1].updateCursor}&timeoutMs=40000`,tokens[1]);
 await delay(32000);
 const beforeAction=await call(`/episodes/${episodeId}/observation`,tokens[0]);check('reads do not extend deadline',beforeAction.control.deadlineAt===deadline);
 const first=await act(0,beforeAction);
 const awakened=await waiting;report.longPollMs=Date.now()-waitedAt;
 check('long poll survives 30 seconds and wakes on peer action',report.longPollMs>=32000&&!awakened.timedOut&&awakened.observation.updates.length>0);
 await recordView(1,awakened.observation);
 const retried=await call(`/episodes/${episodeId}/actions`,tokens[0],first.payload,first.requestId);check('same action retry returns same receipt',isDeepStrictEqual(retried,first.result));
 let accepted=1,terminal;
 for(let step=0;step<40;step++){
  let acted=false;
  for(let i=0;i<3;i++){
   const obs=await call(`/episodes/${episodeId}/observation`,tokens[i]);await recordView(i,obs);
   if(obs.status!=='active'){terminal=obs;break;}
   if(obs.control.required){await act(i,obs);accepted++;acted=true;break;}
  }
  if(terminal)break;check('one seat can act',acted);
 }
 check('server automatically ends and scores game',terminal?.status==='completed'&&terminal.outcome!==null);report.outcome=terminal.outcome;report.acceptedActions=accepted;
 const artifactIds=[];
 for(let i=0;i<3;i++){
  await recorders[i].seal({completeness:'partial',reasoningAvailability:'not-provided',unavailable:['No model or model reasoning: deterministic infrastructure fixture.']});
  await recorders[i].close();
  const path=`artifacts/cloud-v09/deployment-seat-${i+1}-${episodeId}.jsonl`;
  const artifact=await uploadAgentArtifact({baseUrl:base,episodeId,seatToken:tokens[i],file:path,metadata:{reasoningAvailability:'not-provided'}});artifactIds.push(artifact.id);
  const saved=await call(`/episodes/${episodeId}/artifacts/${artifact.id}/content`,tokens[i]);
  check('uploaded trajectory bytes and hash preserved',createHash('sha256').update(saved).digest('hex')===artifact.sha256&&saved.equals(readFileSync(path)));
  // Unowned artifacts deliberately look nonexistent, avoiding existence leaks.
  await call(`/episodes/${episodeId}/artifacts/${artifact.id}/content`,tokens[(i+1)%3],undefined,undefined,404);
 }
 report.artifactIds=artifactIds;
 check('deterministic replay verifies',(await call(`/episodes/${episodeId}/replay`)).valid===true);
 const messages=await call(`/rollouts/${episodeId}/messages`);report.messageSummary=messages;
 const remaining=timeoutAt-Date.now()+1200;if(remaining>0)await delay(remaining);
 const expired=await call(`/episodes/${timeoutEpisode}/observation`,timeoutSeat);check('idle agent is truncated after fixed deadline',expired.status==='truncated'&&expired.control.endReason==='decision_timeout');report.timeoutReason=expired.control.endReason;
 await call(`/rollouts/${episodeId}/annotations`,owner,{kind:'review',text:'Deployment acceptance fixture. Deterministic first-legal-play controller; no LLM or reasoning. Verifies HTTPS, room membership, SSE, long-poll, scoring, messages and artifact persistence.'},undefined,201);
 const oldAfter=await call('/rollouts?limit=1',owner,undefined,undefined,200,oldBase);report.oldEpisodesAfter=oldAfter.total;check('old episodes remain available',oldAfter.total>=oldBefore.total);
 report.allPassed=true;
}catch(error){report.allPassed=false;report.error=String(error.message).slice(0,180);process.exitCode=1;
 if(episodeId)await call(`/episodes/${episodeId}/truncate`,owner,{reason:'deployment-acceptance-cleanup'}).catch(()=>{});
}finally{
 for(const c of controllers)c.abort();for(const r of recorders)await r.close().catch(()=>{});session?.disconnect();
 const text=JSON.stringify(report,null,2)+'\n';assert.ok(![owner,...tokens].some(secret=>text.includes(secret)),'Refuse credential in report');
 writeFileSync('artifacts/cloud-v09/public-acceptance.json',text);console.log(JSON.stringify({allPassed:report.allPassed,checks:report.checks.length,episodeId:report.episodeId,timeoutEpisodeId:report.timeoutEpisodeId,longPollMs:report.longPollMs,artifactCount:report.artifactIds?.length,error:report.error}));
}
