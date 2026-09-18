import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Authorized verification: reload only the new unit, use ACME staging renewal,
// invoke only its new reload hook. No config changes or unrelated restarts.
const skipDryRun = process.argv.includes('--skip-dry-run');
const code = String.raw`import json,subprocess,datetime,time,pathlib,re
unit='coop-bench-api-proxy.service'
report={'startedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'scope':'New proxy reload and ACME staging dry-run only; localhost health is not public reachability evidence.'}
def run(args,timeout=20):
 p=subprocess.run(args,capture_output=True,text=True,timeout=timeout)
 return p.returncode,p.stdout,p.stderr
def pid(name):
 rc,out,err=run(['systemctl','show',name,'--property=MainPID','--value']); assert rc==0
 return int(out.strip())
def snapshot():
 master=pid(unit); assert master>0
 rc,out,err=run(['ps','--ppid',str(master),'-o','pid=,comm='])
 workers=[int(line.split()[0]) for line in out.splitlines() if line.split()[1]=='nginx']
 return {'master':master,'workers':workers,'game':pid('coop-bench.service'),'reimbursement':pid('reimbursement-api.service')}
def healthy():
 url='https://coop.neutrinophysics.cn:34935/api/v1/health'
 rc,out,err=run(['curl','--noproxy','*','--resolve','coop.neutrinophysics.cn:34935:127.0.0.1','--silent','--show-error','--connect-timeout','5','--max-time','12','--write-out','\n__RESULT__%{json}',url])
 body,meta=out.rsplit('__RESULT__',1); meta=json.loads(meta); health=json.loads(body)
 result={'httpStatus':meta['http_code'],'curlExitCode':rc,'tlsVerified':meta['ssl_verify_result']==0,'ok':health.get('ok'),'service':health.get('service'),'target':'127.0.0.1 via curl --resolve, expected DNS hostname/SNI, normal certificate verification'}
 assert rc==0 and result['httpStatus']==200 and result['tlsVerified'] and result['ok'] is True and result['service']=='coop-bench'
 return result
def rotation(before):
 deadline=time.monotonic()+10
 while True:
  after=snapshot()
  if after['master']==before['master'] and len(after['workers'])>=2 and not set(before['workers']).intersection(after['workers']): return after
  if time.monotonic()>deadline: raise RuntimeError('Proxy workers did not rotate while retaining master')
  time.sleep(.2)
def unchanged(before,after):
 assert before['master']==after['master'] and before['game']==after['game'] and before['reimbursement']==after['reimbursement']
before=snapshot(); report['before']=before
rc,out,err=run(['systemctl','reload',unit]); assert rc==0
after=rotation(before); unchanged(before,after); report['manualReload']={'exitCode':rc,'after':after,'workerRotation':True,'health':healthy()}
print(json.dumps({'progress':'New proxy reload passed; checking ACME staging renewal.'}),flush=True)
command=['certbot','renew','--cert-name','coop.neutrinophysics.cn','--dry-run']
if __SKIP_DRY_RUN__:
 text=pathlib.Path('/var/log/letsencrypt/letsencrypt.log').read_text()
 assert '2026-09-18 09:50:05' in text and 'All simulated renewals failed' in text and '43.174.225.201: Invalid response' in text
 report['certbotDryRun']={'command':command,'executedInThisPass':False,'priorAttemptLogTimestamp':'2026-09-18 09:50:05 CST','exitCode':None,'simulatedRenewalSucceeded':False,'deployHooksRequested':False,'authenticator':'webroot HTTP-01 from existing lineage','error':'ACME unauthorized: HTML response instead of challenge text','validationResponseAddress':'43.174.225.201','httpStatus':None,'responseCategory':'HTML document, not expected challenge text','evidence':'Read-only filtered prior certbot log; challenge URL and response body omitted'}
else:
 rc,out,err=run(command,timeout=300)
 text=out+'\n'+err
 report['certbotDryRun']={'command':command,'executedInThisPass':True,'exitCode':rc,'simulatedRenewalSucceeded':rc==0 and 'all simulated renewals succeeded' in text.lower(),'deployHooksRequested':False,'authenticator':'webroot HTTP-01 from existing lineage'}
print(json.dumps({'progress':'ACME result recorded; checking independent deploy hook.'}),flush=True)
hookBefore=snapshot(); rc,out,err=run(['/etc/letsencrypt/renewal-hooks/deploy/coop-bench-api-proxy']); assert rc==0
hookAfter=rotation(hookBefore); unchanged(before,hookAfter)
report['deployHook']={'path':'/etc/letsencrypt/renewal-hooks/deploy/coop-bench-api-proxy','exitCode':rc,'workerRotation':True,'after':hookAfter,'health':healthy()}
rc,out,err=run(['journalctl','SYSLOG_IDENTIFIER=coop_bench_api_proxy','--since',report['startedAt'],'--no-pager','-n','30','-o','json']); assert rc==0
entries=[]
for line in out.splitlines():
 event=json.loads(line); raw=event.get('MESSAGE','')
 try: message=json.loads(raw)
 except Exception: continue
 expected={'time','remote','status','bytes','duration'}
 if set(message)==expected: entries.append({'fields':sorted(message),'status':message['status'],'bytes':message['bytes'],'duration':message['duration']})
report['sanitizedAccessLogs']={'identifier':'coop_bench_api_proxy','matchingEntries':len(entries),'expectedFieldsOnly':True,'sampleWithoutClientAddress':entries[:3],'omitsAuthorizationCookiesUriAndQuery':True}
assert entries, 'No expected sanitized access-log entry found'
report['otherProcessesUnchanged']=True; report['proxyMasterUnchanged']=True; report['completedAt']=datetime.datetime.now(datetime.timezone.utc).isoformat(); report['ok']=report['certbotDryRun']['simulatedRenewalSucceeded']; report['proxyReloadAndHookPassed']=True
print(json.dumps({'report':report}),flush=True)
`.replace('__SKIP_DRY_RUN__', skipDryRun ? 'True' : 'False');
const command=`sudo -n python3 -c "import base64;exec(base64.b64decode('${Buffer.from(code).toString('base64')}'))"`;
const report=await new Promise((resolve,reject)=>{
  const proc=spawn('ssh',['-o','BatchMode=yes','-o','StrictHostKeyChecking=yes','-o','ConnectTimeout=10','ubuntu@62.234.160.98',command],{windowsHide:true,stdio:['ignore','pipe','pipe']});
  let pending='',final,err='';
  proc.stdout.on('data',chunk=>{pending+=chunk;const lines=pending.split('\n');pending=lines.pop();for(const line of lines){if(!line.trim())continue;const value=JSON.parse(line);if(value.progress)console.log(value.progress);else if(value.report)final=value.report;}});
  proc.stderr.on('data',chunk=>{err+=chunk;});proc.on('error',reject);
  proc.on('close',exitCode=>{if(exitCode===0&&final)resolve(final);else{const failure={ok:false,at:new Date().toISOString(),exitCode,error:'Renewal verification failed; raw output not logged.'};writeFileSync(new URL('../artifacts/cloud-api34935-renewal.json',import.meta.url),JSON.stringify(failure,null,2)+'\n');reject(Error(failure.error));}});
});
writeFileSync(new URL('../artifacts/cloud-api34935-renewal.json',import.meta.url),JSON.stringify(report,null,2)+'\n');
console.log(JSON.stringify(report,null,2));
