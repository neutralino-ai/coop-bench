import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
const data=fileURLToPath(new URL('../data/local-server/',import.meta.url));
const out=join(data,'backups');mkdirSync(out,{recursive:true});
const db=new DatabaseSync(join(data,'episodes.sqlite'),{readOnly:true});
try{
  const backup=join(out,`before-security-${Date.now()}.sqlite`);
  db.prepare('VACUUM INTO ?').run(backup);
  const episodes=db.prepare('SELECT id,game_id,status FROM episodes').all();
  console.log(JSON.stringify({backup,episodes,integrity:db.prepare('PRAGMA quick_check').get()}));
}finally{db.close();}
