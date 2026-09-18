"""Read-only database verification on the explicitly deployed cloud host."""
import datetime
import hashlib
import json
import sqlite3

current = sqlite3.connect('file:/var/lib/coop-bench/episodes.sqlite?mode=ro', uri=True)
original = sqlite3.connect('file:/var/backups/coop-bench/pre-artifacts-20260917/latest.sqlite?mode=ro', uri=True)
saved = sqlite3.connect('file:/var/backups/coop-bench/latest.sqlite?mode=ro', uri=True)
try:
    old_ids = [row[0] for row in original.execute('SELECT id FROM episodes')]
    old_evidence_unchanged = True
    for episode in old_ids:
        for table, order in [('events', 'seq'), ('rollout_frames', 'seq'), ('observations', 'id')]:
            query = f'SELECT * FROM {table} WHERE episode_id=? ORDER BY {order}'
            if list(original.execute(query, (episode,))) != list(current.execute(query, (episode,))):
                old_evidence_unchanged = False
    files = []
    for artifact_id, manifest_json, status in saved.execute('SELECT id,manifest,status FROM artifacts ORDER BY id'):
        manifest = json.loads(manifest_json)
        digest = hashlib.sha256()
        size = 0
        for (blob,) in saved.execute('SELECT data FROM artifact_chunks WHERE artifact_id=? ORDER BY chunk_index', (artifact_id,)):
            digest.update(blob)
            size += len(blob)
        files.append({'id': artifact_id, 'status': status, 'bytes': size, 'verified': status == 'complete' and size == manifest['byteLength'] and digest.hexdigest() == manifest['sha256']})
    report = {
        'at': datetime.datetime.now(datetime.timezone.utc).isoformat(),
        'previousEpisodeCount': len(old_ids),
        'originalEventsFramesObservationsUnchanged': old_evidence_unchanged,
        'liveEpisodeCount': current.execute('SELECT COUNT(*) FROM episodes').fetchone()[0],
        'backupEpisodeCount': saved.execute('SELECT COUNT(*) FROM episodes').fetchone()[0],
        'liveArtifactCount': current.execute('SELECT COUNT(*) FROM artifacts').fetchone()[0],
        'backupArtifactCount': len(files),
        'backupIntegrity': saved.execute('PRAGMA quick_check').fetchone()[0],
        'backupArtifactChecks': files,
    }
    print(json.dumps(report, indent=2))
    assert old_evidence_unchanged
    assert report['liveEpisodeCount'] == report['backupEpisodeCount']
    assert report['liveArtifactCount'] == report['backupArtifactCount'] == 3
    assert report['backupIntegrity'] == 'ok' and all(file['verified'] for file in files)
finally:
    current.close()
    original.close()
    saved.close()
