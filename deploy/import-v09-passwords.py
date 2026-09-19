"""One-time verifier copy to an empty v0.9 password table; never copy sessions.

Requires root and an initialized new database. Old SQLite is opened read-only.
No password, verifier or database credential is logged.
"""
import datetime,json,os,pathlib,sqlite3,subprocess
def sql(statement):
 p=subprocess.run(['runuser','-u','postgres','--','psql','-X','-q','-v','ON_ERROR_STOP=1','-At','-d','coop_bench_v09'],input=statement,text=True,capture_output=True,timeout=30)
 if p.returncode:raise RuntimeError('Password import database command failed')
 return p.stdout.strip()
assert os.geteuid()==0,'Root required'
assert sql('SELECT count(*) FROM coop_pg_passwords')=='0','Destination is not empty; refusing overwrite'
assert sql('SELECT count(*) FROM coop_pg_sessions')=='0','Destination already in use; refusing import'
with sqlite3.connect('file:/var/lib/coop-bench/human-auth.sqlite?mode=ro',uri=True) as db:
 db.row_factory=sqlite3.Row
 rows=[dict(row) for row in db.execute('SELECT * FROM passwords')]
q=lambda value:"'"+str(value).replace("'","''")+"'"
statements=['BEGIN;','LOCK TABLE coop_pg_users,coop_pg_passwords IN EXCLUSIVE MODE;']
copied=[]
for row in rows:
 assert (row['kdf_version'],row['kdf_n'],row['kdf_r'],row['kdf_p'])==(1,65536,8,2),'Unexpected password KDF'
 assert len(row['salt'])==16 and len(row['password_hash'])==64,'Unexpected verifier length'
 binding=sql('SELECT token_hash FROM coop_pg_users WHERE id='+q(row['user_id']))
 if binding!=row['binding']:continue
 values=[q(row['user_id']),q(row['binding']),"decode('"+row['salt'].hex()+"','hex')","decode('"+row['password_hash'].hex()+"','hex')",q(row['revision']),'1']
 statements.append('INSERT INTO coop_pg_passwords(user_id,binding,salt,password_hash,revision,kdf_version) VALUES('+','.join(values)+');')
 copied.append(row['user_id'])
statements+=['COMMIT;']
sql('\n'.join(statements))
for row in rows:
 if row['user_id'] not in copied:continue
 expected='|'.join([row['binding'],row['salt'].hex(),row['password_hash'].hex(),row['revision'],'1'])
 actual=sql("SELECT binding||'|'||encode(salt,'hex')||'|'||encode(password_hash,'hex')||'|'||revision||'|'||kdf_version FROM coop_pg_passwords WHERE user_id="+q(row['user_id']))
 assert actual==expected,'Verifier read-back mismatch'
report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'copiedUsers':copied,'sessionsCopied':0,'plaintextPasswordsRead':False,'oldDatabaseMode':'read-only','verifiersVerified':True}
path=pathlib.Path('/etc/coop-bench-v09/password-import.json')
fd=os.open(path,os.O_CREAT|os.O_EXCL|os.O_WRONLY,0o600)
with os.fdopen(fd,'w') as f:json.dump(report,f)
print(json.dumps(report))
