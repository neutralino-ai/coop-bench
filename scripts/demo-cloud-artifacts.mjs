// Normal game and artifact demonstration on the user's already deployed service.
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
const root=fileURLToPath(new URL('../',import.meta.url));
const folder=join(root,'artifacts','cloud-private','artifact-demo'),publicDir=join(root,'artifacts','artifact-release');
const base='https://coop.neutrinophysics.cn/api/v1',owner=readFileSync(join(root,'artifacts','cloud-private','owner.txt'),'utf8').trim();
const stateFile=join(folder,'session.json'),mode=process.argv[2];
mkdirSync(folder,{recursive:true,mode:0o700});mkdirSync(publicDir,{recursive:true});
async function request(path,body){
  const response=await fetch(base+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(30000),headers:{Authorization:`Bearer ${owner}`,...(body?{'Content-Type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  if(!response.ok)throw Error(`Normal demo request returned HTTP ${response.status}.`);
  return response.json();
}
if(mode==='create'){
  if(existsSync(stateFile))throw Error('This demo already exists or creation outcome is uncertain; do not create another.');
  const before=await request('/rollouts');
  writeFileSync(stateFile,JSON.stringify({phase:'creation-pending',beforeIds:before.items.map(item=>item.episodeId)}),{mode:0o600});
  const episode=await request('/episodes',{gameId:'take-time',scenarioId:'official-clock-1-1',playerCount:3,config:{bonusTokens:0}});
  for(const seat of episode.seats){
    const path=join(folder,seat.playerId,'seat.json');mkdirSync(dirname(path),{recursive:true,mode:0o700});
    writeFileSync(path,JSON.stringify({baseUrl:base,episodeId:episode.episodeId,gameId:'take-time',playerId:seat.playerId,seatToken:seat.token},null,2),{mode:0o600});
    writeFileSync(join(dirname(path),'trace-metadata.json'),JSON.stringify({reasoningAvailability:'summary-only',provider:'Codex subagent tool runner'},null,2),{mode:0o600});
  }
  const state={phase:'created',episodeId:episode.episodeId,beforeIds:before.items.map(item=>item.episodeId),method:'Three independent subagents, shared HTTPS API, one unselected random deal',at:new Date().toISOString()};
  writeFileSync(stateFile,JSON.stringify(state,null,2),{mode:0o600});writeFileSync(join(publicDir,'live-demo.json'),JSON.stringify(state,null,2));
  console.log(JSON.stringify({episodeId:episode.episodeId,seats:episode.seats.map(seat=>({playerId:seat.playerId,connectionFile:join(folder,seat.playerId,'seat.json')}))},null,2));
}else if(mode==='verify'){
  const state=JSON.parse(readFileSync(stateFile,'utf8')),rollout=await request(`/rollouts/${state.episodeId}`);
  if(rollout.summary.status==='active')throw Error('Demo is still active.');
  const listed=await request(`/rollouts/${state.episodeId}/artifacts`),identity=await request('/identity'),all=await request('/rollouts');
  const checks={oldEpisodesPreserved:state.beforeIds.every(id=>all.items.some(item=>item.episodeId===id)),discussionRecorded:rollout.frames.filter(frame=>frame.kind==='accepted'&&frame.action?.type==='speak').length,
    threeCompletedTraces:new Set(listed.artifacts.filter(a=>a.kind==='agent-trace'&&a.status==='complete').map(a=>a.playerId)).size===3,downloads:[]};
  for(const artifact of listed.artifacts.filter(a=>a.status==='complete')){
    const response=await fetch(`${base}/rollouts/${state.episodeId}/artifacts/${artifact.id}/content`,{headers:{Authorization:`Bearer ${owner}`},redirect:'error',signal:AbortSignal.timeout(30000)});
    if(!response.ok)throw Error(`Download failed: HTTP ${response.status}`);
    const bytes=Buffer.from(await response.arrayBuffer()),valid=bytes.length===artifact.byteLength&&createHash('sha256').update(bytes).digest('hex')===artifact.sha256;
    const lines=bytes.toString('utf8').trim().split('\n').filter(Boolean).map(line=>JSON.parse(line));
    const requests=lines.filter(line=>line.type==='tool_call'),receipts=new Map(lines.filter(line=>line.type==='tool_result').map(line=>[line.callId,line]));
    const acceptedIds=new Set(requests.filter(line=>receipts.get(line.callId)?.body?.accepted===true).map(line=>line.idempotencyKey));
    const serverActions=rollout.frames.filter(frame=>frame.playerId===artifact.playerId&&frame.kind==='accepted');
    const actionsMatched=serverActions.every(frame=>acceptedIds.has(frame.requestId));
    const forbiddenKeys=[];
    function scan(value){if(value&&typeof value==='object')for(const [key,child]of Object.entries(value)){if(['authorization','seattoken','decisiontoken','apikey','secretkey'].includes(key.toLowerCase()))forbiddenKeys.push(key);scan(child);}}
    scan(lines);
    checks.downloads.push({id:artifact.id,playerId:artifact.playerId,bytes:bytes.length,sha256Valid:valid,logLines:lines.length,apiCalls:requests.length,serverAcceptedActions:serverActions.length,allServerActionsMatchedInClientLog:actionsMatched,credentialFieldsRedacted:forbiddenKeys.length===0,reasoningAvailability:artifact.reasoningAvailability});
    if(!valid)throw Error('Downloaded bytes failed integrity validation.');
    if(!actionsMatched||forbiddenKeys.length||lines[0].playerId!==artifact.playerId||lines[0].episodeId!==state.episodeId)throw Error('Client tool log does not match the player or server evidence.');
  }
  const replay=await request(`/episodes/${state.episodeId}/replay`);
  const report={at:new Date().toISOString(),episodeId:state.episodeId,status:rollout.summary.status,outcome:rollout.summary.outcome,checks,replay,retention:identity.retention,
    evidence:'Client artifacts contain actual tool requests/responses and explicit decision summaries; no hidden reasoning tokens or full model prompt trace is claimed.'};
  writeFileSync(join(publicDir,'live-demo-verification.json'),JSON.stringify(report,null,2));
  writeFileSync(join(publicDir,'live-demo-rollout.json'),JSON.stringify(rollout,null,2));
  console.log(JSON.stringify(report,null,2));
  if(!checks.oldEpisodesPreserved||checks.discussionRecorded<3||!checks.threeCompletedTraces||!replay.valid)process.exitCode=1;
}else throw Error('Usage: node scripts/demo-cloud-artifacts.mjs create|verify');
