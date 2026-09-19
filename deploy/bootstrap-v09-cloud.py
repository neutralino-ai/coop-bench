"""Create only the separate v0.9 database/configuration on the authorized host.

Run as root after PostgreSQL is installed. Existing Coop Bench files are read-only.
Re-running against a populated destination is rejected; no password is printed.
"""
import grp,json,os,pathlib,pwd,secrets,shutil,sqlite3,subprocess

def require(ok,message):
 if not ok: raise RuntimeError(message)
def command(args,stdin=None):
 p=subprocess.run(args,input=stdin,text=True,capture_output=True,timeout=60)
 require(p.returncode==0,'Command failed: '+args[0])
 return p.stdout.strip()
def sql(statement,database='postgres'):
 return command(['runuser','-u','postgres','--','psql','-X','-q','-v','ON_ERROR_STOP=1','-At','-d',database],statement)
def write_private(path,text,mode=0o600,gid=0):
 fd=os.open(path,os.O_WRONLY|os.O_CREAT|os.O_EXCL,mode)
 with os.fdopen(fd,'w') as f:f.write(text)
 os.chown(path,0,gid)

require(os.geteuid()==0,'Root required')
cfg=pathlib.Path('/etc/coop-bench-v09')
require(not cfg.exists(),'Destination configuration already exists; inspect before retry')
require(not sql("SELECT 1 FROM pg_roles WHERE rolname='coop_bench_v09'"),'Destination role exists')
require(not sql("SELECT 1 FROM pg_database WHERE datname='coop_bench_v09'"),'Destination database exists')
require(command(['systemctl','is-active','coop-bench'])=='active','Old service must remain active')
ports={int(line.split()[3].rsplit(':',1)[-1]) for line in command(['ss','-H','-ltn']).splitlines()}
require(not ports.intersection({8789,34936}),'Destination port is occupied')
old_users=pathlib.Path('/etc/coop-bench/access-users.json')
users=json.loads(old_users.read_text())
require(users.get('version')==1 and any(u['id']=='owner' for u in users['users']),'Existing users unavailable')
try:pwd.getpwnam('coop-bench-v09')
except KeyError:command(['useradd','--system','--user-group','--home-dir','/var/lib/coop-bench-v09','--shell','/usr/sbin/nologin','coop-bench-v09'])
account=pwd.getpwnam('coop-bench-v09')
for path,mode in [('/opt/coop-bench-v09/releases',0o755),('/etc/coop-bench-v09',0o750),('/var/lib/coop-bench-v09',0o700),('/var/backups/coop-bench-v09',0o700)]:
 pathlib.Path(path).mkdir(parents=True,exist_ok=True,mode=mode)
 os.chmod(path,mode)
os.chown(cfg,0,account.pw_gid)
os.chown('/var/lib/coop-bench-v09',account.pw_uid,account.pw_gid)
password=secrets.token_urlsafe(36)
sql("CREATE ROLE coop_bench_v09 LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION CONNECTION LIMIT 30 PASSWORD '"+password+"';")
sql('CREATE DATABASE coop_bench_v09 OWNER coop_bench_v09 TEMPLATE template0;')
sql('REVOKE ALL ON DATABASE coop_bench_v09 FROM PUBLIC;')
sql('REVOKE CREATE ON SCHEMA public FROM PUBLIC;','coop_bench_v09')
env='\n'.join(['COOP_DATABASE_URL=postgresql://coop_bench_v09:'+password+'@127.0.0.1:5432/coop_bench_v09',
 'COOP_ADMIN_TOKEN='+secrets.token_urlsafe(48),'COOP_USERS_FILE=/etc/coop-bench-v09/access-users.json',
 'COOP_TRUSTED_PROXY_ORIGIN=https://coop.neutrinophysics.cn','PORT=8789','COOP_SERVE_WEB=0'])+'\n'
write_private(cfg/'server.env',env)
write_private(cfg/'access-users.json',json.dumps(users)+'\n',0o640,account.pw_gid)
print(json.dumps({'result':'created-separate-database-and-config','database':'coop_bench_v09','userCount':len(users['users']),'backendPort':8789,'publicPort':34936,'oldService':command(['systemctl','is-active','coop-bench'])}))
