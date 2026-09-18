import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

// Read-only diagnostic. Never decrypt stored client credentials or log any token.
const configPath = join(process.env.APPDATA, 'Coop Bench Client', 'remote-connection.json');
const config = existsSync(configPath) ? JSON.parse(readFileSync(configPath, 'utf8')) : null;
const report = { checkedAt: new Date().toISOString(), readOnly: true,
  client: { configExists: !!config, apiUrl: config?.apiUrl ?? null, hasEncryptedField: typeof config?.encrypted === 'string' },
  windowsHealth: [], remote: null };
function run(command, args, input = '') {
  return new Promise(resolve => {
    const child = spawn(command, args, { windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] });
    let stdout = '', stderr = ''; const timer = setTimeout(() => child.kill(), 35000);
    child.stdout.on('data', data => { stdout += data; });
    child.stderr.on('data', data => { stderr += data; });
    child.on('error', () => { clearTimeout(timer); resolve({ code: -1, stdout: '', stderr: 'PROCESS_START_ERROR' }); });
    child.on('close', code => { clearTimeout(timer); resolve({ code, stdout, stderr }); });
    child.stdin.on('error', () => {}); child.stdin.end(input);
  });
}
const urls = new Set(['https://coop.neutrinophysics.cn/api/v1/health', 'https://coop.neutrinophysics.cn:34935/api/v1/health']);
if (config?.apiUrl) {
  const parsed = new URL(config.apiUrl);
  if (parsed.protocol === 'https:' && parsed.hostname === 'coop.neutrinophysics.cn' && !parsed.username && !parsed.password) urls.add(parsed.origin + '/api/v1/health');
}
const windows = Promise.all([...urls].map(async url => {
  const result = await run('curl.exe', ['--silent', '--show-error', '--max-time', '12', '--connect-timeout', '6', '--dump-header', '-', '--output', 'NUL', '--write-out', '\n__DIAG__%{json}', url]);
  const [headers, raw = '{}'] = result.stdout.split('__DIAG__');
  let meta = {}; try { meta = JSON.parse(raw); } catch {}
  const header = name => headers.match(new RegExp('^' + name + ':\\s*(.*?)\\r?$', 'gmi'))?.at(-1)?.split(':').slice(1).join(':').trim() ?? null;
  return { source: 'windows-normal-network-path', url, httpStatus: meta.http_code ?? 0, curlExitCode: result.code,
    contentType: header('content-type'), authenticationScheme: header('www-authenticate')?.split(/\s+/)[0] ?? null,
    tlsVerified: meta.http_code > 0 && meta.ssl_verify_result === 0, error: meta.errormsg || result.stderr.trim() || null };
}));
const python = String.raw`import sys,json,subprocess,urllib.request,urllib.error
data=json.load(sys.stdin)
report={'sshSucceeded':True,'services':{},'listeners':[],'requests':[]}
for name in ['nginx','coop-bench']:
 p=subprocess.run(['systemctl','is-active',name],capture_output=True,text=True)
 report['services'][name]={'exitCode':p.returncode,'state':p.stdout.strip()}
p=subprocess.run(['ss','-H','-ltn'],capture_output=True,text=True,check=True)
for line in p.stdout.splitlines():
 fields=line.split(); address=fields[3]; port=address.rsplit(':',1)[-1]
 if port in ['22','443','34935','8788']: report['listeners'].append({'localAddress':address,'port':int(port)})
for path,auth in [('/api/v1/health',False),('/api/v1/identity',True)]:
 headers={'Accept':'application/json'}
 if auth: headers['Authorization']='Bearer '+data['token']
 request=urllib.request.Request('http://127.0.0.1:8788'+path,headers=headers)
 try:
  with urllib.request.urlopen(request,timeout=8) as response:
   raw=response.read(131072); body=json.loads(raw); item={'path':path,'httpStatus':response.status,'contentType':response.headers.get('Content-Type')}
   if auth: item.update({'id':body.get('id'),'role':body.get('role'),'credentialSource':'existing-local-owner-file'})
   else: item.update({'ok':body.get('ok'),'service':body.get('service'),'apiVersion':body.get('apiVersion')})
 except urllib.error.HTTPError as e: item={'path':path,'httpStatus':e.code,'contentType':e.headers.get('Content-Type'),'authenticationScheme':e.headers.get('WWW-Authenticate','').split(' ')[0] or None}
 except Exception as e: item={'path':path,'httpStatus':None,'errorType':type(e).__name__}
 report['requests'].append(item)
print(json.dumps(report))
`;
const token = readFileSync(new URL('../artifacts/cloud-private/owner.txt', import.meta.url), 'utf8').trim();
const command = `python3 -c "import base64;exec(base64.b64decode('${Buffer.from(python).toString('base64')}'))"`;
const ssh = run('ssh', ['-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', '-o', 'ConnectTimeout=10', 'ubuntu@62.234.160.98', command], JSON.stringify({ token }));
report.windowsHealth = await windows;
const remote = await ssh;
if (remote.code === 0) report.remote = JSON.parse(remote.stdout);
else report.remote = { sshSucceeded: false, exitCode: remote.code, error: 'Read-only SSH diagnostic failed; stderr deliberately not logged.' };
const serialized = JSON.stringify(report, null, 2) + '\n';
if (serialized.includes(token)) throw Error('Refusing secret output');
writeFileSync(new URL('../artifacts/client-connection-diagnosis.json', import.meta.url), serialized);
console.log(serialized);
