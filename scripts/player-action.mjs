import { readFileSync,writeFileSync,mkdirSync,existsSync,appendFileSync } from 'node:fs';
import { dirname,join } from 'node:path';
const [seatFile,tool,requestFile]=process.argv.slice(2);
if(!seatFile||!['read_rules','observe','act','send_message','reflect'].includes(tool))throw Error('Usage: node scripts/player-action.mjs SEAT_FILE read_rules|observe|act|send_message|reflect [REQUEST_JSON_FILE]');
const config=JSON.parse(readFileSync(seatFile,'utf8')),folder=dirname(seatFile),latestPath=join(folder,'observation.json');
const headers={Authorization:`Bearer ${config.seatToken}`};
const base=config.baseUrl.replace(/\/$/,'');
const endpoint=`${base}/episodes/${encodeURIComponent(config.episodeId)}`;
const tracePath=join(folder,'agent-tools.jsonl');
function redact(value){
  if(Array.isArray(value))return value.map(redact);
  if(value&&typeof value==='object')return Object.fromEntries(Object.entries(value).filter(([key])=>!['authorization','seattoken','decisiontoken','apikey','secretkey'].includes(key.toLowerCase())).map(([key,entry])=>[key,redact(entry)]));
  return value;
}
function journal(entry){appendFileSync(tracePath,JSON.stringify({at:new Date().toISOString(),...entry})+'\n',{mode:0o600});}
if(!existsSync(tracePath))journal({type:'session',schema:'coop-agent-tools-v1',episodeId:config.episodeId,playerId:config.playerId,
  reasoningAvailability:'summary-only',recordedScope:'Actual API tool requests and responses from this script, including agent-authored decision summaries and reflections.',
  unavailable:['Full model prompts and responses outside these tool calls','Provider private reasoning','Provider token IDs and token usage'],
  redactedFields:['Authorization','seatToken','decisionToken','apiKey','secretKey']});
const latest=existsSync(latestPath)?JSON.parse(readFileSync(latestPath,'utf8')):null;
function summarize(obs){return {...obs,legalActions:obs.legalActions?.map(a=>({...a,...(a.examples?{examples:a.examples.slice(0,2)}:{})}))};}
async function request(url,options={}){
  const callId=crypto.randomUUID();
  journal({type:'tool_call',callId,tool,url,method:options.method??'GET',idempotencyKey:options.headers?.['Idempotency-Key']??null,...(options.body?{body:redact(JSON.parse(options.body))}:{})});
  try{
    const response=await fetch(url,{...options,redirect:'error',signal:AbortSignal.timeout(20000)}),body=await response.json();
    journal({type:'tool_result',callId,tool,status:response.status,body:redact(body)});return {status:response.status,body};
  }catch(error){journal({type:'tool_error',callId,tool,error:'Request failed or response unavailable; outcome may be uncertain.'});throw error;}
}
if(tool==='read_rules'){
  const {status,body}=await request(`${base}/games/${encodeURIComponent(config.gameId)}`);console.log(JSON.stringify({httpStatus:status,...body},null,2));
}else if(tool==='observe'){
  const {status,body}=await request(`${endpoint}/observation?after=${latest?.updateCursor??0}`,{headers});
  if(status===200)writeFileSync(latestPath,JSON.stringify(body,null,2));
  console.log(JSON.stringify({httpStatus:status,...summarize(body)},null,2));
}else if(tool==='reflect'){
  const input=JSON.parse(readFileSync(requestFile,'utf8'));
  if(typeof input.text!=='string')throw Error('Reflection file requires a text field.');
  const {status,body}=await request(`${endpoint}/reflections`,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({text:input.text})});
  console.log(JSON.stringify({httpStatus:status,...body},null,2));
}else{
  if(!latest)throw Error('Read your observation first.');
  const input=JSON.parse(readFileSync(requestFile,'utf8'));
  if(!/^[A-Za-z0-9._-]{1,100}$/.test(input.requestId??''))throw Error('Supply a unique requestId (reuse unchanged on retry).');
  if(tool==='send_message'&&!['speak','message','chat','communicate','hint','signal'].includes(input.action?.type))throw Error('Use the actual rule-permitted message action.');
  const requests=join(folder,'requests');mkdirSync(requests,{recursive:true});
  const path=join(requests,`${input.requestId}.json`);
  const requested={action:input.action,...(input.decisionSummary?{decisionSummary:input.decisionSummary}:{})};
  let command={observationId:latest.observationId,decisionToken:latest.decisionToken,...requested};
  if(existsSync(path)){
    command=JSON.parse(readFileSync(path,'utf8'));
    if(JSON.stringify({action:command.action,...(command.decisionSummary?{decisionSummary:command.decisionSummary}:{})})!==JSON.stringify(requested))throw Error('Request ID reused with changed content.');
  }else writeFileSync(path,JSON.stringify(command,null,2));
  const {status,body}=await request(`${endpoint}/actions`,{method:'POST',headers:{...headers,'Content-Type':'application/json','Idempotency-Key':input.requestId},body:JSON.stringify(command)});
  if(body.observation&&latest.decisionToken===command.decisionToken)writeFileSync(latestPath,JSON.stringify(body.observation,null,2));
  console.log(JSON.stringify({httpStatus:status,...body,...(body.observation?{observation:summarize(body.observation)}:{})},null,2));
}
