// Authorized, short-lived read-only diagnostic for this single server/domain.
// Firewall schemas checked against Tencent CreateFirewallRules/DeleteFirewallRules:
// https://cloud.tencent.com/document/api/1207/48254
// https://cloud.tencent.com/document/api/1207/48253
import { randomUUID, createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { lookup } from 'node:dns/promises';
import { fileURLToPath } from 'node:url';
import { readEnvCredentials } from './vendor/env-file.mjs';
import { signTc3 } from './vendor/tc3.mjs';

const address='62.234.160.98',domain='coop.neutrinophysics.cn',instanceId='lhins-g98xlmte',region='ap-beijing';
// Both forms are accepted: --port34935 and --port=34935. Only the two ports
// explicitly authorized for this diagnostic are eligible for a firewall change.
const arguments_=process.argv.slice(2);
if(arguments_.length>1||arguments_.some(value=>!/^--port=?\d+$/.test(value)))throw Error('USAGE_PORT_ONLY');
const port=arguments_.length?Number(arguments_[0].replace(/^--port=?/,'')):8443;
if(![8443,34935].includes(port))throw Error('PORT_NOT_AUTHORIZED');
const marker=`coop-${port}-diagnostic-`+randomUUID().slice(0,8);
const desired={Protocol:'TCP',Port:String(port),CidrBlock:'0.0.0.0/0',Action:'ACCEPT',FirewallRuleDescription:marker};
const report={schema:'coop-port-diagnostic/v1',startedAt:new Date().toISOString(),address,domain,instanceId,region,port,marker,
  scope:'Temporary HTTPS GET health only; no credentials or game writes; original production nginx remains stopped.',
  calls:[],firewallMutationAttempted:false,remoteMutationAttempted:false,cleanup:{},
  references:['https://cloud.tencent.com/document/api/1207/48254','https://cloud.tencent.com/document/api/1207/48253']};
const output=fileURLToPath(new URL(`../artifacts/client-port${port}-check.json`,import.meta.url));
let credentials,before;
const fields=['Protocol','Port','CidrBlock','Ipv6CidrBlock','Action','FirewallRuleDescription'];
const normalize=rule=>Object.fromEntries(fields.map(k=>[k,rule[k]??'']));
const key=rule=>JSON.stringify(normalize(rule));
const safeError=error=>({name:String(error?.name??'Error').slice(0,80),code:/^[A-Za-z0-9_.-]{1,100}$/.test(error?.message??'')?error.message:(error?.cause?.code??error?.code??'NETWORK_OR_OPERATION_ERROR')});
function save(){const text=JSON.stringify(report,null,2)+'\n';if(credentials&&Object.values(credentials).some(value=>text.includes(value)))throw Error('SECRET_IN_REPORT');mkdirSync(fileURLToPath(new URL('../artifacts/',import.meta.url)),{recursive:true});writeFileSync(output,text,{mode:0o600});}

const remotePython=String.raw`
import sys,json,base64,pathlib,subprocess,time,hashlib,socket,urllib.request,urllib.error,ssl
p=json.loads(base64.b64decode(PAYLOAD)); marker=p['marker']; port=p['port']; assert port in [8443,34935]
prefix='coop-'+str(port)+'-diagnostic-'; assert marker.startswith(prefix) and len(marker)==len(prefix)+8 and all(c in '0123456789abcdef' for c in marker[-8:])
root=pathlib.Path('/run')/marker; config=root/'nginx.conf'; unit=marker+'.service'
def run(args):
 r=subprocess.run(args,capture_output=True,text=True,timeout=15); return {'code':r.returncode,'stdout':r.stdout.strip(),'stderr':r.stderr.strip()}
def listeners(): return run(['ss','-H','-ltnp'])['stdout'].splitlines()
def port_listeners(lines): return [s for s in lines if any(v.endswith(':'+str(port)) for v in s.split())]
def status(): return run(['systemctl','is-active','nginx'])['stdout']
def sha(path): return hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
def ensure_own():
 assert root.parent==pathlib.Path('/run') and root.name==marker
 assert not root.is_symlink() and (root/'owner').read_text()==marker
if p['operation']=='preflight':
 lines=listeners(); out={'nginxState':status(),'nginxEnabled':run(['systemctl','is-enabled','nginx'])['stdout'],'listeners':lines,'portListeners':port_listeners(lines),'diagnosticDirectoryAbsent':not root.exists(),'productionConfigSha256':sha('/etc/nginx/sites-available/coop-bench'),'recentNginxJournal':run(['journalctl','-u','nginx','-n','10','--no-pager'])['stdout']}
elif p['operation']=='start':
 assert status()=='inactive','PRODUCTION_NGINX_STATE_CHANGED'
 assert not port_listeners(listeners()),'REQUESTED_PORT_OCCUPIED'
 root.mkdir(mode=0o700); (root/'owner').write_text(marker)
 configuration='''worker_processes 1;
pid ROOT/nginx.pid;
error_log ROOT/error.log warn;
events { worker_connections 32; }
http {
 access_log off;
 server_tokens off;
 client_max_body_size 1k;
 client_header_timeout 5s;
 client_body_timeout 5s;
 keepalive_timeout 5s;
 server {
  listen DIAGNOSTIC_PORT ssl;
  server_name coop.neutrinophysics.cn;
  ssl_certificate /etc/letsencrypt/live/coop.neutrinophysics.cn/fullchain.pem;
  ssl_certificate_key /etc/letsencrypt/live/coop.neutrinophysics.cn/privkey.pem;
  ssl_protocols TLSv1.2 TLSv1.3;
  if ($host != coop.neutrinophysics.cn) { return 421; }
  if ($ssl_server_name != coop.neutrinophysics.cn) { return 421; }
  location = /api/v1/health {
   if ($request_method != GET) { return 405; }
   proxy_pass http://127.0.0.1:8788;
   proxy_pass_request_body off;
   proxy_set_header Content-Length "";
   proxy_set_header Host coop.neutrinophysics.cn;
   proxy_set_header Authorization "";
   proxy_set_header Cookie "";
   proxy_set_header Connection "";
   proxy_set_header Forwarded "";
   proxy_set_header X-Forwarded-For "";
   proxy_set_header X-Forwarded-Host "";
   proxy_set_header X-Forwarded-Proto "";
   proxy_connect_timeout 2s;
   proxy_read_timeout 5s;
   proxy_buffering off;
  }
  location / { return 404; }
 }
}
'''.replace('ROOT',str(root)).replace('DIAGNOSTIC_PORT',str(port))
 config.write_text(configuration)
 checked=run(['nginx','-t','-c',str(config)])
 assert checked['code']==0,'DIAGNOSTIC_NGINX_CONFIG_INVALID'
 started=run(['systemd-run','--unit='+unit,'--collect','--property=RuntimeMaxSec=180s','--property=KillMode=control-group','/usr/sbin/nginx','-g','daemon off;','-c',str(config)])
 assert started['code']==0,'DIAGNOSTIC_NGINX_START_FAILED'
 for i in range(20):
  if port_listeners(listeners()): break
  time.sleep(.1)
 out={'configTest':checked['code']==0,'diagnosticUnit':unit,'runtimeLimitSeconds':180,'portListeners':port_listeners(listeners()),'nginxProductionState':status()}
 assert out['portListeners'],'DIAGNOSTIC_NOT_LISTENING'
elif p['operation']=='probe':
 out={'scope':'server ordinary DNS and public hostname; no --resolve, no loopback hostname substitution','dns':sorted({a[4][0] for a in socket.getaddrinfo('coop.neutrinophysics.cn',port)})}
 try:
  with urllib.request.urlopen('https://coop.neutrinophysics.cn:'+str(port)+'/api/v1/health',timeout=10,context=ssl.create_default_context()) as response:
   data=response.read(16385); out.update({'httpStatus':response.status,'contentType':response.headers.get('content-type'),'bytes':len(data),'tlsCertificateValidation':True})
   try:
    body=json.loads(data); out['health']={k:body.get(k) for k in ['ok','service','apiVersion','build']}
   except: out['bodySha256']=hashlib.sha256(data).hexdigest()
 except Exception as error: out['error']={'name':type(error).__name__,'message':str(error)[:240]}
elif p['operation']=='cleanup':
 was_present=root.exists()
 if was_present:
  ensure_own()
  stopped=run(['systemctl','stop',unit])
  for i in range(20):
   if not port_listeners(listeners()): break
   time.sleep(.1)
  assert not port_listeners(listeners()),'DIAGNOSTIC_LISTENER_STILL_RUNNING'
  allowed={'owner','nginx.conf','nginx.pid','error.log'}
  assert all(f.name in allowed and f.is_file() and not f.is_symlink() for f in root.iterdir()),'UNEXPECTED_DIAGNOSTIC_FILE'
  for f in root.iterdir(): f.unlink()
  root.rmdir()
 out={'diagnosticDirectoryAbsent':not root.exists(),'portListeners':port_listeners(listeners()),'productionNginxState':status(),'productionConfigSha256':sha('/etc/nginx/sites-available/coop-bench'),'diagnosticUnitState':run(['systemctl','is-active',unit])['stdout'],'productionConfigTest':run(['nginx','-t'])['code']==0}
else: raise Exception('UNEXPECTED_OPERATION')
print(json.dumps(out))
`;
function remote(operation){
 const payload=Buffer.from(JSON.stringify({operation,marker,port})).toString('base64');
 const script=remotePython.replace('PAYLOAD',JSON.stringify(payload));
 const result=spawnSync('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@'+address,'sudo -n python3 -'],{input:script,encoding:'utf8',windowsHide:true,timeout:30000,maxBuffer:65536});
 if(result.status!==0){report.remoteErrors??=[];report.remoteErrors.push({operation,exitCode:result.status,stderr:result.stderr?.slice(-1500)});throw Error('REMOTE_'+operation.toUpperCase()+'_FAILED');}
 return JSON.parse(result.stdout);
}
async function api(action,payload){
 if(!['DescribeInstances','DescribeFirewallRules','CreateFirewallRules','DeleteFirewallRules'].includes(action))throw Error('UNEXPECTED_API');
 const host='lighthouse.tencentcloudapi.com',body=JSON.stringify(payload),timestamp=Math.floor(Date.now()/1000);
 const response=await fetch('https://'+host+'/',{method:'POST',redirect:'error',signal:AbortSignal.timeout(20000),body,headers:{
  Authorization:signTc3({...credentials,host,service:'lighthouse',action,body,timestamp}),'Content-Type':'application/json; charset=utf-8',Host:host,
  'X-TC-Action':action,'X-TC-Timestamp':String(timestamp),'X-TC-Version':'2020-03-24','X-TC-Region':region}});
 if(!response.ok)throw Error('TENCENT_HTTP_'+response.status);
 const value=(await response.json()).Response;
 if(!value)throw Error('INVALID_TENCENT_RESPONSE');
 report.calls.push({action,requestId:value.RequestId,...(value.Error?{error:value.Error.Code}:{})});save();
 if(value.Error)throw Error(value.Error.Code);
 return value;
}
async function firewall(){const result=await api('DescribeFirewallRules',{InstanceId:instanceId,Offset:0,Limit:100});if(!Array.isArray(result.FirewallRuleSet)||result.TotalCount!==result.FirewallRuleSet.length||!Number.isInteger(result.FirewallVersion))throw Error('INCOMPLETE_FIREWALL');return {version:result.FirewallVersion,rules:result.FirewallRuleSet.map(normalize)};}
async function windowsProbe(){
 const out={scope:'Windows ordinary domain request; no IP override, no disabled TLS verification',url:`https://${domain}:${port}/api/v1/health`};
 try{out.dns=await lookup(domain,{all:true});}catch(error){out.dnsError=safeError(error);}
 try{const response=await fetch(out.url,{redirect:'error',signal:AbortSignal.timeout(10000)});const reader=response.body.getReader();let size=0,parts=[];while(true){const {done,value}=await reader.read();if(done)break;size+=value.length;if(size>16384){await reader.cancel();throw Error('DIAGNOSTIC_BODY_TOO_LARGE');}parts.push(value);}const bytes=Buffer.concat(parts);out.httpStatus=response.status;out.contentType=response.headers.get('content-type');out.tlsCertificateValidation=true;try{const body=JSON.parse(bytes);out.health=Object.fromEntries(['ok','service','apiVersion','build'].map(k=>[k,body[k]]));}catch{out.bodySha256=createHash('sha256').update(bytes).digest('hex');}}catch(error){out.error=safeError(error);}return out;
}

try{
 report.preflight=remote('preflight');save();
 if(report.preflight.nginxState!=='inactive'||report.preflight.portListeners.length||!report.preflight.diagnosticDirectoryAbsent)throw Error('PREFLIGHT_STATE_CHANGED');
 credentials=readEnvCredentials('C:\\Users\\xuefe\\Documents\\ChatGPT\\报销\\env.txt');
 const instances=await api('DescribeInstances',{InstanceIds:[instanceId],Limit:1});
 if(instances.TotalCount!==1||instances.InstanceSet?.[0]?.InstanceId!==instanceId||!instances.InstanceSet[0].PublicAddresses?.includes(address))throw Error('INSTANCE_IDENTITY_MISMATCH');
 before=report.firewallBefore=await firewall();
 if(before.rules.some(rule=>rule.FirewallRuleDescription===marker))throw Error('MARKER_COLLISION');
 // Do not alter or reuse a pre-existing rule: its semantics/ownership differ.
 if(before.rules.some(rule=>['TCP','ALL'].includes(rule.Protocol)&&(rule.Port==='ALL'||String(rule.Port).split(',').some(part=>{const [lo,hi=lo]=part.split('-').map(Number);return lo<=port&&hi>=port;}))))throw Error('PREEXISTING_PORT_RULE_REQUIRES_REVIEW');
 report.firewallMutationAttempted=true;save();
 await api('CreateFirewallRules',{InstanceId:instanceId,FirewallVersion:before.version,FirewallRules:[desired]});
 const after=report.firewallDuring=await firewall();
 if(after.rules.length!==before.rules.length+1||!after.rules.some(rule=>key(rule)===key(desired))||!before.rules.every(rule=>after.rules.some(item=>key(item)===key(rule))))throw Error('FIREWALL_WRITE_READBACK_MISMATCH');
 report.remoteMutationAttempted=true;save();report.listener=remote('start');save();
 report.windows=await windowsProbe();save();report.server=remote('probe');save();
 report.result=report.windows.health?.ok===true?'windows-normal-domain-health-reachable':'diagnostic-completed-without-windows-success';
}catch(error){report.error=safeError(error);report.result='unable-to-complete-diagnostic';process.exitCode=1;}
finally{
 if(report.remoteMutationAttempted){try{report.cleanup.remote=remote('cleanup');}catch(error){report.cleanup.remoteError=safeError(error);process.exitCode=1;}}
 else report.cleanup.remote={notCreated:true};
 if(report.firewallMutationAttempted){try{
  const current=await firewall(),own=current.rules.filter(rule=>key(rule)===key(desired));
  if(own.length>1)throw Error('AMBIGUOUS_OWN_RULE');
  if(own.length)await api('DeleteFirewallRules',{InstanceId:instanceId,FirewallVersion:current.version,FirewallRules:[desired]});
  const final=report.firewallAfter=await firewall();
  report.cleanup.firewall={ownRuleAbsent:!final.rules.some(rule=>rule.FirewallRuleDescription===marker),originalRulesPreserved:before.rules.every(rule=>final.rules.some(item=>key(item)===key(rule))),exactOriginalRules:final.rules.length===before.rules.length&&before.rules.every(rule=>final.rules.some(item=>key(item)===key(rule)))};
  if(!report.cleanup.firewall.ownRuleAbsent||!report.cleanup.firewall.originalRulesPreserved)throw Error('FIREWALL_CLEANUP_READBACK_MISMATCH');
 }catch(error){report.cleanup.firewallError=safeError(error);process.exitCode=1;}}
 else report.cleanup.firewall={notCreated:true};
 report.finishedAt=new Date().toISOString();save();
 console.log(JSON.stringify({report:output,result:report.result,error:report.error,windows:report.windows,server:report.server,cleanup:report.cleanup},null,2));
}
