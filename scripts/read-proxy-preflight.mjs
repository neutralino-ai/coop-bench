import { spawn } from 'node:child_process';
import { writeFileSync } from 'node:fs';

// Read-only metadata inspection. Never reads certificate private keys or app env.
const code = String.raw`import json,subprocess,pathlib,re,datetime
def run(args):
 p=subprocess.run(args,capture_output=True,text=True)
 return {'exitCode':p.returncode,'stdout':p.stdout.strip()}
report={'checkedAt':datetime.datetime.now(datetime.timezone.utc).isoformat(),'readOnly':True}
units=run(['systemctl','list-unit-files','--no-legend','--no-pager'])['stdout'].splitlines()
names=[line.split()[0] for line in units if re.search(r'(nginx|29375|reimbursement-api|coop.*(backup|proxy|api)|certbot)',line.split()[0])]
report['units']=[]
for name in names:
 props=run(['systemctl','show',name,'--property=Id,ActiveState,SubState,MainPID,FragmentPath,UnitFileState,Triggers,NextElapseUSecRealtime,LastTriggerUSec,Result,ExecMainStatus,ExecMainExitTimestamp'])
 item=dict(line.split('=',1) for line in props['stdout'].splitlines() if '=' in line)
 start=run(['systemctl','show',name,'--property=ExecStart','--value'])['stdout']
 item['executable']=re.findall(r'path=([^ ;]+)',start)
 item['configFlags']=re.findall(r'(?:^|\s)(-[cp])\s+([^ ;]+)',start)
 report['units'].append(item)
processes=[]; configs={'/etc/nginx/nginx.conf'}
for proc in pathlib.Path('/proc').glob('[0-9]*'):
 try:
  cmd=(proc/'cmdline').read_bytes().decode(errors='replace').replace(chr(0),' ').strip()
  if not cmd.startswith('nginx:'): continue
  meta={'pid':int(proc.name),'kind':'master' if 'master process' in cmd else 'worker'}
  meta['configFlags']=re.findall(r'(?:^|\s)(-[cp])\s+([^ ;]+)',cmd)
  for flag,value in meta['configFlags']:
   if flag=='-c': configs.add(value)
  processes.append(meta)
 except (OSError,PermissionError): pass
report['nginxProcesses']=processes
for unit in report['units']:
 for flag,value in unit['configFlags']:
  if flag=='-c': configs.add(value)
report['nginxConfigs']=[]
for name in sorted(configs):
 path=pathlib.Path(name)
 if not path.is_file(): continue
 text=path.read_text(); directives=[]
 for line in text.splitlines():
  line=line.strip()
  if re.match(r'^(pid|error_log|access_log|listen|include|ssl_certificate|proxy_pass|server_name)\s',line): directives.append(line)
 report['nginxConfigs'].append({'path':str(path),'directives':directives})
report['renewal']=[]
for path in pathlib.Path('/etc/letsencrypt/renewal').glob('*.conf'):
 fields={}
 for line in path.read_text().splitlines():
  match=re.match(r'\s*(authenticator|installer|webroot_path|pre_hook|post_hook|deploy_hook)\s*=\s*(.*)',line)
  if match: fields[match.group(1)]=match.group(2)
 report['renewal'].append({'path':str(path),'fields':fields})
report['renewalHooks']=[]
for path in pathlib.Path('/etc/letsencrypt/renewal-hooks').glob('*/*'):
 if path.is_file():
  text=path.read_text(); safe=[]
  for line in text.splitlines():
   line=line.strip()
   if not line or line.startswith('#'): continue
   if re.fullmatch(r'(set -[a-z]+|(?:/usr/sbin/)?nginx -t(?: -c /[A-Za-z0-9_./-]+)?|(?:/bin/|/usr/bin/)?systemctl (?:try-)?reload [A-Za-z0-9_.-]+|if (?:/bin/|/usr/bin/)?systemctl is-active --quiet [A-Za-z0-9_.-]+; then|fi)',line): safe.append(line)
   else: safe.append('[other hook command omitted; not executed]')
  report['renewalHooks'].append({'path':str(path),'commands':safe})
report['listeners']=[]
for line in run(['ss','-H','-ltnp'])['stdout'].splitlines():
 if line.split()[3].rsplit(':',1)[-1] in ['22','80','443','8788','29375','34935']: report['listeners'].append(line)
report['publicCertificate']=run(['openssl','x509','-in','/etc/letsencrypt/live/coop.neutrinophysics.cn/fullchain.pem','-noout','-enddate'])
print(json.dumps(report))
`;
const command = `sudo -n python3 -c "import base64;exec(base64.b64decode('${Buffer.from(code).toString('base64')}'))"`;
const result = await new Promise((resolve, reject) => {
  const proc = spawn('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'ubuntu@62.234.160.98', command], { windowsHide:true, stdio:['ignore','pipe','pipe'] });
  let stdout='',stderr=''; proc.stdout.on('data',d=>stdout+=d); proc.stderr.on('data',d=>stderr+=d);
  const timer=setTimeout(()=>proc.kill(),30000); proc.on('error',reject);
  proc.on('close',code=>{clearTimeout(timer);if(code!==0)reject(Error('Read-only SSH metadata inspection failed.'));else resolve(JSON.parse(stdout));});
});
writeFileSync(new URL('../artifacts/cloud-api34935-preflight.json',import.meta.url),JSON.stringify(result,null,2)+'\n');
console.log(JSON.stringify(result,null,2));
