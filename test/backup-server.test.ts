import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtempSync, readdirSync, unlinkSync, rmdirSync, symlinkSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { backupServer } from '../scripts/backup-server.mjs';

test('online backup retains committed WAL records and artifact bytes; rotation preserves prior snapshot', async () => {
  const dir = mkdtempSync(join(tmpdir(), 'coop-backup-')), source = join(dir, 'live.sqlite'), out = join(dir, 'backups');
  const db = new DatabaseSync(source);
  try {
    db.exec('PRAGMA journal_mode=WAL; CREATE TABLE episodes(id TEXT); CREATE TABLE artifact_chunks(data BLOB); CREATE TABLE agent_messages(payload TEXT); CREATE TABLE agent_message_completions(payload TEXT);');
    const message = JSON.stringify({role:'assistant',reasoning_content:'synthetic fixture only',token_ids:[42,71]});
    db.prepare('INSERT INTO agent_messages VALUES(?)').run(message);
    db.prepare('INSERT INTO agent_message_completions VALUES(?)').run('{"completeness":"partial"}');
    db.prepare('INSERT INTO episodes VALUES(?)').run('first');
    const bytes = Buffer.from([0, 1, 255, 128, 6]);
    db.prepare('INSERT INTO artifact_chunks VALUES(?)').run(bytes);
    const first = await backupServer(source, out);
    assert.equal(first.counts.episodes, 1); assert.equal(first.counts.artifact_chunks, 1);
    assert.equal(first.counts.agent_messages, 1); assert.equal(first.counts.agent_message_completions, 1);
    db.prepare('INSERT INTO episodes VALUES(?)').run('second');
    const second = await backupServer(source, out);
    assert.equal(second.counts.episodes, 2); assert.equal(second.previousAvailable, true);
    const latest = new DatabaseSync(join(out, 'latest.sqlite'), { readOnly: true }), previous = new DatabaseSync(join(out, 'previous.sqlite'), { readOnly: true });
    try {
      assert.equal(latest.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n, 2);
      assert.equal(previous.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n, 1);
      assert.deepEqual(Buffer.from(latest.prepare('SELECT data FROM artifact_chunks').get()!.data as Uint8Array), bytes);
      assert.equal(latest.prepare('SELECT payload FROM agent_messages').get()!.payload, message);
    } finally { latest.close(); previous.close(); }
    assert.equal(db.prepare('SELECT COUNT(*) AS n FROM episodes').get()!.n, 2);
  } finally {
    db.close();
    for (const file of readdirSync(out)) unlinkSync(join(out, file));
    rmdirSync(out); for (const file of readdirSync(dir)) unlinkSync(join(dir, file)); rmdirSync(dir);
  }
});

test('backup command works through a release symlink or Windows junction', () => {
  const dir=mkdtempSync(join(tmpdir(),'coop-backup-entry-')),source=join(dir,'live.sqlite'),out=join(dir,'backups'),alias=join(dir,'current');
  const db=new DatabaseSync(source);db.exec('CREATE TABLE episodes(id TEXT);');db.prepare('INSERT INTO episodes VALUES(?)').run('saved');db.close();
  symlinkSync(fileURLToPath(new URL('../scripts/',import.meta.url)),alias,process.platform==='win32'?'junction':'dir');
  try{
    const result=spawnSync(process.execPath,[join(alias,'backup-server.mjs'),source,out],{encoding:'utf8'});
    assert.equal(result.status,0,result.stderr);assert.equal(JSON.parse(result.stdout).counts.episodes,1);
    assert.equal(JSON.parse(readFileSync(join(out,'latest.json'),'utf8')).integrity,'ok');
  }finally{
    if(process.platform==='win32')rmdirSync(alias);else unlinkSync(alias);
    for(const file of readdirSync(out))unlinkSync(join(out,file));rmdirSync(out);
    for(const file of readdirSync(dir))unlinkSync(join(dir,file));rmdirSync(dir);
  }
});
