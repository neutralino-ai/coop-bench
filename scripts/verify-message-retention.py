"""Read-only preservation checks for the message feature upgrade on the deployed host."""
import datetime
import json
import sqlite3

def connect(path):
    return sqlite3.connect('file:' + path + '?mode=ro', uri=True)

live = connect('/var/lib/coop-bench/episodes.sqlite')
before = connect('/var/backups/coop-bench/pre-messages-20260917/latest.sqlite')
saved = connect('/var/backups/coop-bench/latest.sqlite')
try:
    unchanged = {}
    # Compare the complete pre-upgrade tables, including exact artifact BLOBs.
    for table in ['episodes', 'events', 'observations', 'rollout_frames', 'artifacts', 'artifact_chunks']:
        query = 'SELECT * FROM ' + table + ' ORDER BY rowid'
        unchanged[table] = list(before.execute(query)) == list(live.execute(query))
    copied = {}
    for table in ['episodes', 'events', 'artifacts', 'artifact_chunks', 'agent_messages', 'agent_message_completions']:
        query = 'SELECT * FROM ' + table + ' ORDER BY rowid'
        copied[table] = list(live.execute(query)) == list(saved.execute(query))
    counts = {table: live.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in copied}
    report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'beforeTablesUnchanged': unchanged,
              'backupMatchesLive': copied, 'counts': counts, 'integrity': saved.execute('PRAGMA quick_check').fetchone()[0]}
    assert all(unchanged.values()) and all(copied.values()) and report['integrity'] == 'ok'
    print(json.dumps(report, indent=2))
finally:
    live.close()
    before.close()
    saved.close()
