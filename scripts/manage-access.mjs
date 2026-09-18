import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { newAccessToken, readAccessUsers, tokenHash, validateAccessUsers } from '../src/access-control.ts';
import { defaultDataDir, writePrivateJson } from '../src/local-settings.ts';

function fail(message){throw new Error(message);}
const usage='Usage: node scripts/manage-access.mjs <list|add|revoke> [--data-dir DIR | --users-file FILE] [add: --id NAME --role auditor|operator --out PRIVATE_TOKEN_FILE --expires-in-days 30] [revoke: --id NAME]';
try {
  const [command,...args]=process.argv.slice(2),options={};
  if(!['list','add','revoke'].includes(command))fail(usage);
  const allowed=['--data-dir','--users-file',...(command==='add'?['--id','--role','--out','--expires-in-days']:command==='revoke'?['--id']:[])];
  for(let i=0;i<args.length;i+=2){
    const key=args[i],value=args[i+1];
    if(!allowed.includes(key)||Object.hasOwn(options,key)||!value||value.startsWith('--'))fail(usage);
    options[key]=value;
  }
  if(options['--data-dir']&&options['--users-file'])fail('Choose --data-dir or --users-file.');
  const file=resolve(options['--users-file']??join(options['--data-dir']??defaultDataDir(),'access-users.json'));
  const config=readAccessUsers(file,true);
  if(command==='list'){
    console.log(JSON.stringify({users:config.users.map(({id,role,disabled,expiresAt})=>({id,role,disabled,expiresAt:expiresAt??null}))},null,2));
  }else if(command==='revoke'){
    if(!options['--id'])fail('--id is required.');
    const user=config.users.find(u=>u.id===options['--id']);if(!user)fail('Unknown access user.');
    user.disabled=true;validateAccessUsers(config);writePrivateJson(file,config);
    console.log(`Revoked ${user.id}. New requests using this credential are denied immediately.`);
  }else {
    if(!options['--id']||!options['--role']||!options['--out'])fail('add requires --id, --role and --out.');
    if(config.users.some(u=>u.id===options['--id']))fail('This id already exists. Use a new id for replacement credentials.');
    const days=Number(options['--expires-in-days']??30);if(!Number.isInteger(days)||days<1||days>365)fail('--expires-in-days must be an integer from 1 to 365.');
    const out=resolve(options['--out']);if(out===file||existsSync(out))fail('Token output must be a new, separate private file.');
    const token=newAccessToken(),user={id:options['--id'],role:options['--role'],disabled:false,tokenHash:tokenHash(token),expiresAt:new Date(Date.now()+days*86400000).toISOString()};
    config.users.push(user);validateAccessUsers(config);
    mkdirSync(dirname(file),{recursive:true,mode:0o700});mkdirSync(dirname(out),{recursive:true,mode:0o700});
    let created=false;
    try {writeFileSync(out,token+'\n',{flag:'wx',mode:0o600});created=true;writePrivateJson(file,config);}
    catch(error){if(created)unlinkSync(out);throw error;}
    console.log(`Created ${user.id} (${user.role}), expires ${user.expiresAt}. Credential saved to ${out}; no credential is printed.`);
  }
}catch(error){console.error(`Access configuration: ${error.message}`);process.exitCode=1;}
