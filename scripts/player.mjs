import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { createInterface } from 'node:readline';
import { randomUUID } from 'node:crypto';
import { PlayerRuntime } from '../client/runtime.mjs';
import { MinimalAgent } from '../client/minimal-agent.mjs';
import { invitation } from '../client/protocol.mjs';

const file=process.argv[2];if(!file)throw Error('Usage: node scripts/player.mjs PRIVATE_CONFIG.json');
const config=JSON.parse(readFileSync(resolve(file),'utf8')),directory=resolve(config.directory??join(dirname(resolve(file)),'player-data'));
mkdirSync(directory,{recursive:true,mode:0o700});
const sessionFile=join(directory,'membership.json');
let saved;try{saved=JSON.parse(readFileSync(sessionFile,'utf8'));}catch(error){if(error.code!=='ENOENT')throw error;}
if(saved&&config.invitation){const target=invitation(config.invitation);if(target.roomId!==saved.roomId||target.apiUrl!==saved.apiUrl)throw Error('Use a separate directory for each room and seat.');}
const runtime=new PlayerRuntime({...config,...(config.invitation?invitation(config.invitation):{}),...saved,directory});
writeFileSync(sessionFile,JSON.stringify({...runtime.credentials(),...(config.invitation?{inviteToken:invitation(config.invitation).inviteToken}:{})}),{mode:0o600});
const output=data=>process.stdout.write(JSON.stringify(data)+'\n');
if(config.mode==='model')runtime.attachAgent(new MinimalAgent({baseUrl:config.baseUrl,model:config.model,apiKey:process.env[config.apiKeyEnv??'MODEL_API_KEY']}));
else {
  // A Codex/subagent host can consume JSONL and reply with {id,action}. No secret
  // or other seat's context crosses this boundary. Stdin never runs shell code.
  const pending=new Map(),lines=createInterface({input:process.stdin,crlfDelay:Infinity});
  lines.on('line',line=>{try{if(line.length>65536)throw Error();const data=JSON.parse(line),entry=pending.get(data.id);if(!entry)return;
    pending.delete(data.id);entry.resolve(data.action?{action:data.action}:{wait:true});}catch{output({type:'input-error',message:'Expected JSON {id,action} (64 KiB maximum).'});}});
  runtime.attachAgent({decide(context,{signal}) {return new Promise((resolve,reject)=>{const id=randomUUID();
    const abort=()=>{pending.delete(id);reject(Error('Decision cancelled.'));};signal.addEventListener('abort',abort,{once:true});
    pending.set(id,{resolve:value=>{signal.removeEventListener('abort',abort);resolve(value);}});output({type:'decision',id,context});});}});
}
let readyVersion=null;
runtime.on('state',snapshot=>{
  output({type:'status',status:snapshot.status,room:snapshot.room,trace:snapshot.trace});
  const room=snapshot.room;
  if(config.autoReady!==false&&room?.status==='waiting'&&readyVersion!==room.rosterVersion){readyVersion=room.rosterVersion;runtime.ready().catch(()=>{readyVersion=null;});}
});
for(const event of ['trace-warning','connection-warning','agent-warning'])runtime.on(event,message=>output({type:event,message}));
let stopping=false;async function close(){if(stopping)return;stopping=true;await runtime.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
try{await runtime.connect();await runtime.run();await close();}catch(error){output({type:'error',message:error.code??'PLAYER_RUNTIME_FAILED'});await runtime.close();process.exit(1);}
