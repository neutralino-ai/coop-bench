"""Install the reviewed, allowlisted archive into independent v0.9 paths only."""
import hashlib,json,os,pathlib,pwd,shutil,subprocess,tarfile,time,urllib.request
ARCHIVE=pathlib.Path('/tmp/coop-bench-v09-df1cf9a3efa3.tar.gz')
SHA256='6e0d104e383a772bb51c1f355d1d1c2e5f898877ff8d8703605c9ddb506ade27'
BUILD='df1cf9a3efa36a3bfde9660a7eb1d8167058808ac4c61af8343d7514cf79b26e'
BASE=pathlib.Path('/opt/coop-bench-v09')
def run(args):
 p=subprocess.run(args,text=True,capture_output=True,timeout=40)
 if p.returncode:raise RuntimeError('Installation command failed: '+' '.join(args))
 return p.stdout.strip()
def snapshot():
 return {name:run(['systemctl','show',name,'--property=MainPID,ActiveState,ActiveEnterTimestamp']) for name in ['coop-bench','coop-bench-api-proxy','reimbursement-api']}
def install(source,dest,mode):
 path=pathlib.Path(dest)
 assert not path.exists() and not path.is_symlink(),'Destination file already exists: '+dest
 with path.open('xb') as f:f.write(source.read_bytes())
 os.chmod(path,mode)
assert os.geteuid()==0
before=snapshot()
assert hashlib.sha256(ARCHIVE.read_bytes()).hexdigest()==SHA256,'Archive digest mismatch'
release=BASE/'releases'/BUILD[:12]
assert not release.exists() and not (BASE/'current').exists(),'Release destination exists'
with tarfile.open(ARCHIVE,'r:gz') as tar:
 members=tar.getmembers()
 assert all(m.isfile() and not pathlib.PurePosixPath(m.name).is_absolute() and '..' not in pathlib.PurePosixPath(m.name).parts for m in members),'Unsafe archive member'
 manifest=json.load(tar.extractfile('release-manifest.json'))
 assert manifest['sourceBuild']==BUILD and manifest['containsCredentials'] is False and manifest['containsData'] is False
 assert sorted(m.name for m in members)==sorted([x['path'] for x in manifest['files']]+['release-manifest.json'])
 for file in manifest['files']:
  data=tar.extractfile(file['path']).read()
  assert hashlib.sha256(data).hexdigest()==file['sha256'] and len(data)==file['size'],'Manifest mismatch'
 release.mkdir(mode=0o755)
 tar.extractall(release,filter='data')
for path in release.rglob('*'):
 os.chmod(path,0o755 if path.is_dir() or path.suffix=='.sh' else 0o644)
(BASE/'current').symlink_to(release,target_is_directory=True)
for name in ['coop-bench-v09.service','coop-bench-v09-proxy.service','coop-bench-v09-backup.service','coop-bench-v09-backup.timer']:
 install(release/'deploy/postgres'/name,'/etc/systemd/system/'+name,0o644)
install(release/'deploy/postgres/nginx-api34936.conf','/etc/coop-bench-v09/api-proxy.conf',0o644)
install(release/'deploy/postgres/renew-api34936.sh','/etc/letsencrypt/renewal-hooks/deploy/coop-bench-v09-proxy',0o755)
pg=pwd.getpwnam('postgres');os.chown('/var/backups/coop-bench-v09',pg.pw_uid,pg.pw_gid);os.chmod('/var/backups/coop-bench-v09',0o700)
run(['systemctl','daemon-reload'])
run(['systemctl','start','coop-bench-v09.service'])
for n in range(40):
 try:
  with urllib.request.urlopen('http://127.0.0.1:8789/api/v1/health',timeout=2) as r:health=json.load(r)
  if health.get('ok') and health.get('build')==BUILD:break
 except Exception:pass
 time.sleep(.25)
else:raise RuntimeError('New backend health did not pass; old services remain untouched')
assert snapshot()==before,'Unrelated service state changed'
print(json.dumps({'result':'new-backend-started','build':BUILD,'apiHealth':health,'oldServicesUnchanged':True,'publicProxyStarted':False}))
