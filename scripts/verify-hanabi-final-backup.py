"""Run on the deployed host after a completed game and an online full backup.

Read-only checks; prints counts and booleans, never credentials or card state.
"""
import datetime
import json
import sqlite3

EPISODE = '5286719d-dcf7-48d1-81e8-2c1d2ba5c639'

def connect(path):
    db = sqlite3.connect('file:' + path + '?mode=ro', uri=True)
    db.execute('BEGIN')
    return db

live = connect('/var/lib/coop-bench/episodes.sqlite')
before = connect('/var/backups/coop-bench/pre-hanabi-20260917/latest.sqlite')
saved = connect('/var/backups/coop-bench/latest.sqlite')
try:
    retained = {}
    for table in ['episodes', 'events', 'observations', 'rollout_frames', 'artifacts', 'artifact_chunks']:
        query = 'SELECT * FROM ' + table + ' ORDER BY rowid'
        retained[table] = set(before.execute(query)).issubset(set(live.execute(query)))
    copied = {}
    for table in ['episodes', 'events', 'observations', 'rollout_frames', 'artifacts', 'artifact_chunks',
                  'agent_messages', 'agent_message_completions', 'rollout_annotations']:
        query = 'SELECT * FROM ' + table + ' ORDER BY rowid'
        copied[table] = list(live.execute(query)) == list(saved.execute(query))
    counts = {table: live.execute('SELECT COUNT(*) FROM ' + table).fetchone()[0] for table in copied}
    episode_counts = {table: saved.execute('SELECT COUNT(*) FROM ' + table + ' WHERE episode_id=?', (EPISODE,)).fetchone()[0]
                      for table in ['events', 'observations', 'rollout_frames', 'artifacts', 'agent_messages', 'agent_message_completions']}
    status = saved.execute('SELECT status FROM episodes WHERE id=?', (EPISODE,)).fetchone()[0]
    completed_artifacts = saved.execute("SELECT COUNT(*) FROM artifacts WHERE episode_id=? AND status='complete'", (EPISODE,)).fetchone()[0]
    report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'episodeId': EPISODE,
              'oldRowsRetained': retained, 'backupMatchesLive': copied, 'counts': counts,
              'episodeCounts': episode_counts, 'episodeStatus': status, 'completedArtifacts': completed_artifacts,
              'backupIntegrity': saved.execute('PRAGMA quick_check').fetchone()[0]}
    assert all(retained.values()) and all(copied.values()) and report['backupIntegrity'] == 'ok'
    assert status == 'completed' and completed_artifacts == 6 and episode_counts['agent_message_completions'] == 3
    print(json.dumps(report, indent=2))
finally:
    live.close()
    before.close()
    saved.close()
