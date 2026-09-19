"""Restore a fresh full dump into a uniquely named disposable database only."""
import datetime,hashlib,json,pathlib,secrets,subprocess
def command(args,input=None):
 p=subprocess.run(args,input=input,text=True,capture_output=True,timeout=150)
 if p.returncode:raise RuntimeError('Backup verification command failed: '+args[0])
 return p.stdout.strip()
def psql(db,text):return command(['runuser','-u','postgres','--','psql','-X','-q','-At','-v','ON_ERROR_STOP=1','-d',db],text)
def snapshot(db):
 tables=psql(db,"SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename").splitlines()
 result={}
 for table in tables:
  assert table.startswith('coop_pg_') and table.replace('_','').isalnum()
  value=psql(db,'SELECT count(*)::text||\'|\'||coalesce(md5(string_agg(md5(t::text),\'\' ORDER BY md5(t::text))),\'empty\') FROM "'+table+'" t')
  count,digest=value.split('|');result[table]={'count':int(count),'digest':digest}
 return result
source='coop_bench_v09'
assert psql(source,"SELECT count(*) FROM coop_pg_episodes WHERE data->>'status'='active'")=='0','Wait until deployment fixtures finish before snapshot comparison'
before=snapshot(source)
command(['systemctl','start','coop-bench-v09-backup.service'])
directory=pathlib.Path('/var/backups/coop-bench-v09')
archive=max(directory.glob('coop-bench-v09-*.dump'),key=lambda p:p.stat().st_mtime)
digest=hashlib.sha256(archive.read_bytes()).hexdigest()
assert archive.with_suffix('.dump.sha256').read_text().split()[0]==digest
temporary='coop_v09_restorecheck_'+secrets.token_hex(5)
assert temporary.startswith('coop_v09_restorecheck_') and temporary!='coop_bench_v09'
created=False
try:
 command(['runuser','-u','postgres','--','createdb','--template=template0',temporary]);created=True
 command(['runuser','-u','postgres','--','pg_restore','--exit-on-error','--no-owner','--no-acl','--dbname='+temporary,str(archive)])
 restored=snapshot(temporary)
 assert restored==before,'Restored table count/digest differs from source snapshot'
 assert snapshot(source)==before,'Source changed concurrently; repeat snapshot test when idle'
 report={'at':datetime.datetime.now(datetime.timezone.utc).isoformat(),'backup':str(archive),'sha256':digest,'bytes':archive.stat().st_size,'tableCount':len(restored),'rowCounts':{k:v['count'] for k,v in restored.items()},'allTableDigestsMatch':True,'restoredIntoSeparateDatabase':True}
finally:
 if created:command(['runuser','-u','postgres','--','dropdb',temporary])
report['temporaryDatabaseRemoved']=True
print(json.dumps(report))
