import { DatabaseSync, backup } from 'node:sqlite';
import { randomUUID } from 'node:crypto';
import { existsSync, mkdirSync, copyFileSync, renameSync, chmodSync, statSync, writeFileSync, realpathSync, lstatSync } from 'node:fs';
import { resolve, join, dirname, basename } from 'node:path';
import { pathToFileURL } from 'node:url';

/** SQLite's online backup captures a consistent database, including artifact BLOBs and WAL changes. */
export async function backupServer(source, directory) {
  const dbPath = realpathSync(resolve(source));
  mkdirSync(resolve(directory), { recursive: true, mode: 0o700 });
  const out = realpathSync(resolve(directory));
  const latest = join(out, 'latest.sqlite'), previous = join(out, 'previous.sqlite');
  if ([latest, previous].includes(dbPath)) throw Error('Backup destination must differ from the live database.');
  const sourceStat = statSync(dbPath);
  for (const target of [latest, previous, join(out, 'latest.json')]) if (existsSync(target)) {
    const info = lstatSync(target);
    if (!info.isFile() || info.isSymbolicLink() || realpathSync(target) === dbPath || (info.ino === sourceStat.ino && info.dev === sourceStat.dev)) throw Error('Backup destination aliases a protected file or is not a regular file.');
  }
  const pending = join(out, `pending-${randomUUID()}.sqlite`);
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try { await backup(db, pending); } finally { db.close(); }
  chmodSync(pending, 0o600);
  const verify = new DatabaseSync(pending, { readOnly: true });
  let counts;
  try {
    if (verify.prepare('PRAGMA quick_check').get().quick_check !== 'ok') throw Error('Backup integrity check failed; prior snapshots retained.');
    const tables = new Set(verify.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map(row => row.name));
    counts = Object.fromEntries(['episodes', 'events', 'observations', 'rollout_frames', 'artifacts', 'artifact_chunks', 'agent_messages', 'agent_message_completions'].filter(table => tables.has(table)).map(table => [table, Number(verify.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n)]));
  } finally { verify.close(); }
  // Rotate complete snapshots only. Never deletes or edits records in the live database.
  if (existsSync(latest)) {
    const pendingPrevious = join(out, `pending-previous-${randomUUID()}.sqlite`);
    copyFileSync(latest, pendingPrevious); chmodSync(pendingPrevious, 0o600); renameSync(pendingPrevious, previous);
  }
  renameSync(pending, latest);
  const report = { at: new Date().toISOString(), database: dbPath, latest, previousAvailable: existsSync(previous), integrity: 'ok', bytes: statSync(latest).size, counts,
    retention: 'Live trajectories and artifacts have no automatic expiry. Backups retain the latest two complete whole-database snapshots on this server.' };
  writeFileSync(join(out, 'latest.json'), JSON.stringify(report, null, 2) + '\n', { mode: 0o600 });
  return report;
}
if (process.argv[1] && import.meta.url === pathToFileURL(realpathSync(resolve(process.argv[1]))).href) {
  try {
    const [source, directory] = process.argv.slice(2);
    if (!source || !directory || process.argv.length !== 4) throw Error('Usage: node scripts/backup-server.mjs LIVE_SQLITE BACKUP_DIRECTORY');
    const report = await backupServer(source, directory);
    const authSource = join(dirname(resolve(source)), 'human-auth.sqlite');
    if (basename(source) === 'episodes.sqlite' && existsSync(authSource)) {
      const auth = await backupServer(authSource, join(directory, 'human-auth'));
      report.humanAuthentication = { integrity: auth.integrity, latest: auth.latest, bytes: auth.bytes };
    }
    console.log(JSON.stringify(report, null, 2));
  } catch (error) { console.error(`Backup failed: ${error.message}`); process.exitCode = 1; }
}
