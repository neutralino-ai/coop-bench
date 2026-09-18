"""Guarded upgrade of the existing Coop Bench release and its scoped API proxy.

Invoked via SSH stdin. The default path is read-only. No database restore,
credential changes, global nginx changes, or unrelated restarts occur here.
"""
import base64
import collections
import datetime
import fcntl
import hashlib
import io
import json
import os
import pathlib
import re
import sqlite3
import subprocess
import sys
import tarfile
import time
import urllib.error
import urllib.request
import uuid

CURRENT = pathlib.Path('/opt/coop-bench/current')
RELEASES = pathlib.Path('/opt/coop-bench/releases')
DATA = pathlib.Path('/var/lib/coop-bench')
PROXY = pathlib.Path('/etc/coop-bench/api-proxy.conf')
GAME_UNIT = 'coop-bench.service'
PROXY_UNIT = 'coop-bench-api-proxy.service'
AUTH_LINES = {
    '~^GET:/api/v1/auth/(status|account)$ 1;',
    '~^POST:/api/v1/auth/(login|password|logout)$ 1;',
}
ALLOWED_FILES = {
    'app/src/server.mjs', 'app/build-manifest.json',
    *('app/web/' + name for name in ['index.html', 'app.js', 'transport.js', 'style.css', 'play.html', 'play.js', 'play.css']),
    *('app/scripts/' + name for name in ['backup-server.mjs', 'upload-agent-artifact.mjs', 'agent-message-recorder.mjs', 'manage-access.mjs']),
    *('deploy/' + name for name in ['coop-bench.service', 'coop-bench-backup.service', 'coop-bench-backup.timer', 'coop-bench.env.example', 'journald-coop-bench.conf', 'Caddyfile.example', 'nginx-coop-bench-http.conf.example', 'nginx-coop-bench.conf.example', 'logrotate-nginx-coop-bench.example']),
    *('docs/' + name for name in ['cloud-deployment.md', 'agent-artifacts.md', 'agent-messages.md', 'take-time-communication.md']),
}


def check(condition, message):
    if not condition:
        raise RuntimeError(message)


def sha(data):
    return hashlib.sha256(data).hexdigest()


def regular(path):
    return path.is_file() and not path.is_symlink()


def command(args, timeout=30):
    result = subprocess.run(args, capture_output=True, timeout=timeout)
    check(result.returncode == 0, 'COMMAND_FAILED:' + args[0] + ':' + args[1])
    return result.stdout.decode().strip()


def service(name):
    values = command(['systemctl', 'show', name, '--property=MainPID,ActiveState,SubState'])
    return dict(line.split('=', 1) for line in values.splitlines())


def snapshot():
    check(CURRENT.is_symlink(), 'CURRENT_NOT_SYMLINK')
    current = CURRENT.resolve(strict=True)
    check(current.parent == RELEASES and re.fullmatch('[a-f0-9]{12,64}', current.name), 'UNEXPECTED_RELEASE_TARGET')
    paths = [*pathlib.Path('/etc/coop-bench').glob('*'),
             pathlib.Path('/etc/nginx/nginx.conf'),
             pathlib.Path('/etc/nginx/sites-available/coop-bench'),
             pathlib.Path('/etc/nginx/sites-available/up-the-chain'),
             pathlib.Path('/etc/reimbursement/nginx-api.conf'),
             pathlib.Path('/etc/systemd/system/reimbursement-api.service'),
             pathlib.Path('/etc/systemd/system/coop-bench.service'),
             pathlib.Path('/etc/systemd/system/coop-bench-backup.service'),
             pathlib.Path('/etc/systemd/system/coop-bench-api-proxy.service')]
    protected = {str(path): sha(path.read_bytes()) for path in paths if regular(path) and path != PROXY}
    check(regular(PROXY), 'SCOPED_PROXY_NOT_REGULAR')
    return {'current': str(current), 'proxySha256': sha(PROXY.read_bytes()), 'protectedHashes': protected,
            'services': {name: service(name) for name in [GAME_UNIT, PROXY_UNIT, 'nginx.service', 'reimbursement-api.service']}}


def databases():
    names = sorted(path.name for path in DATA.glob('*.sqlite') if path.name != 'instance-lock.sqlite')
    check(set(names) <= {'episodes.sqlite', 'human-auth.sqlite'} and 'episodes.sqlite' in names, 'UNEXPECTED_DURABLE_DATABASE_SET')
    check(all(regular(DATA / name) for name in names), 'DATABASE_NOT_REGULAR')
    return names


def connect_readonly(path):
    db = sqlite3.connect(path.as_uri() + '?mode=ro', uri=True, timeout=10)
    db.execute('PRAGMA query_only=ON')
    return db


def database_snapshot(path):
    with connect_readonly(path) as db:
        db.execute('BEGIN')
        check(db.execute('PRAGMA quick_check').fetchone()[0] == 'ok', 'DATABASE_INTEGRITY_FAILED')
        tables = sorted(row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"))
        result = {}
        for name in tables:
            quoted = '"' + name.replace('"', '""') + '"'
            columns = [row[1] for row in db.execute('PRAGMA table_info(' + quoted + ')')]
            rows = []
            for row in db.execute('SELECT * FROM ' + quoted):
                values = [('blob', value.hex()) if isinstance(value, bytes) else (type(value).__name__, value) for value in row]
                rows.append(sha(json.dumps(values, ensure_ascii=False, separators=(',', ':')).encode()))
            result[name] = {'columns': columns, 'rows': sorted(rows)}
        return result


def summarize(tables):
    return {name: {'rows': len(table['rows']), 'rowSetSha256': sha('\n'.join(table['rows']).encode())} for name, table in tables.items()}


def preserved(before, after):
    for name, table in before.items():
        check(name in after and table['columns'] == after[name]['columns'], 'OLD_TABLE_SCHEMA_CHANGED:' + name)
        old = collections.Counter(table['rows'])
        new = collections.Counter(after[name]['rows'])
        check(not old - new, 'OLD_DATABASE_ROWS_CHANGED:' + name)
    return before == after


def backup_all(directory):
    directory.mkdir(mode=0o700, parents=True, exist_ok=False)
    result = {}
    for name in databases():
        source = DATA / name
        destination = directory / name
        with connect_readonly(source) as db:
            with sqlite3.connect(destination) as backup:
                db.backup(backup)
        destination.chmod(0o600)
        result[name] = summarize(database_snapshot(destination))
    return result


def valid_archive(payload):
    packed = base64.b64decode(payload['archiveBase64'], validate=True)
    check(len(packed) <= 8 * 1024 * 1024 and sha(packed) == payload['archiveSha256'], 'ARCHIVE_HASH_OR_SIZE')
    files = {}
    with tarfile.open(fileobj=io.BytesIO(packed), mode='r:gz') as archive:
        members = archive.getmembers()
        check(1 <= len(members) <= 100, 'ARCHIVE_ENTRY_COUNT')
        check(sum(member.size for member in members) <= 32 * 1024 * 1024, 'ARCHIVE_EXPANDED_SIZE')
        for member in members:
            path = member.name
            check(member.isfile() and path not in files and 0 <= member.size <= 16 * 1024 * 1024, 'ARCHIVE_ENTRY_TYPE')
            check(path == 'release-manifest.json' or path in ALLOWED_FILES, 'ARCHIVE_PATH_NOT_ALLOWED')
            check(not member.linkname and not any(key.startswith('GNU.sparse') for key in member.pax_headers), 'ARCHIVE_LINK_OR_SPARSE')
            body = archive.extractfile(member).read(16 * 1024 * 1024 + 1)
            check(len(body) == member.size, 'ARCHIVE_ENTRY_SIZE')
            files[path] = body
    manifest = json.loads(files['release-manifest.json'])
    check(manifest['schema'] == 'coop-bench-cloud-release/v1' and manifest['containsData'] is False and manifest['containsCredentials'] is False, 'INVALID_RELEASE_MANIFEST')
    check(re.fullmatch('[a-f0-9]{64}', manifest['sourceBuild']) is not None, 'INVALID_SOURCE_BUILD')
    check(manifest['entry'] == 'app/src/server.mjs' and len(manifest['files']) == len(ALLOWED_FILES), 'INVALID_MANIFEST_ENTRY_SET')
    listed = [entry['path'] for entry in manifest['files']]
    check(len(listed) == len(set(listed)) and set(listed) == ALLOWED_FILES and set(files) == ALLOWED_FILES | {'release-manifest.json'}, 'ARCHIVE_MANIFEST_FILE_SET')
    for entry in manifest['files']:
        check(len(files[entry['path']]) == entry['size'] and sha(files[entry['path']]) == entry['sha256'], 'MANIFEST_FILE_HASH_MISMATCH')
    check(json.loads(files['app/build-manifest.json'])['sourceBuild'] == manifest['sourceBuild'], 'EMBEDDED_BUILD_MISMATCH')
    return manifest, files


def strip_auth_routes(text):
    return '\n'.join(line.rstrip() for line in text.replace('\r\n', '\n').splitlines() if line.strip() not in AUTH_LINES)


def atomic_proxy(content):
    temporary = PROXY.with_name('.api-proxy.' + uuid.uuid4().hex + '.tmp')
    with temporary.open('xb') as file:
        file.write(content)
        file.flush()
        os.fsync(file.fileno())
    temporary.chmod(0o644)
    os.replace(temporary, PROXY)


def switch(target):
    check(target.parent == RELEASES and target.is_dir() and not target.is_symlink(), 'INVALID_RELEASE_SWITCH')
    temporary = CURRENT.with_name('.current-auth-' + uuid.uuid4().hex)
    temporary.symlink_to(target)
    os.replace(temporary, CURRENT)


def request(path, token=''):
    check(path.startswith('/api/v1/') and not any(char in path for char in '\r\n?#'), 'INVALID_VERIFICATION_PATH')
    headers = {'Accept': 'application/json'}
    if token:
        headers['Authorization'] = 'Bearer ' + token
    with urllib.request.urlopen(urllib.request.Request('http://127.0.0.1:8788' + path, headers=headers), timeout=12) as response:
        body = response.read(16 * 1024 * 1024 + 1)
        check(response.status == 200 and len(body) <= 16 * 1024 * 1024, 'API_VERIFICATION_FAILED')
        return json.loads(body), len(body)


def wait_health(build):
    for attempt in range(60):
        try:
            health, _ = request('/api/v1/health')
            if health.get('ok') is True and health.get('build') == build:
                return {'httpStatus': 200, 'build': build}
        except (OSError, ValueError, urllib.error.URLError):
            pass
        time.sleep(0.25)
    raise RuntimeError('NEW_RELEASE_HEALTH_FAILED')


def main(payload):
    before = snapshot()
    check(before['services'][GAME_UNIT]['ActiveState'] == 'active', 'GAME_NOT_ACTIVE')
    check(before['services'][PROXY_UNIT]['ActiveState'] == 'active', 'SCOPED_PROXY_NOT_ACTIVE')
    check(before['services']['nginx.service']['ActiveState'] == 'inactive', 'GLOBAL_NGINX_CHANGED')
    report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'apply': payload.get('apply') is True,
              'before': before, 'durableDatabases': databases(), 'excludedEphemeralDatabase': 'instance-lock.sqlite'}
    with connect_readonly(DATA / 'episodes.sqlite') as db:
        report['activeEpisodes'] = db.execute("SELECT count(*) FROM episodes WHERE status='active'").fetchone()[0]
        report['existingEpisodeCount'] = db.execute('SELECT count(*) FROM episodes').fetchone()[0]
        historical_ids = [row[0] for row in db.execute('SELECT id FROM episodes ORDER BY id')]
    if not payload.get('archiveBase64'):
        check(not report['apply'], 'APPLY_REQUIRES_ARCHIVE')
        report['result'] = 'read-only-preflight'
        return report
    manifest, files = valid_archive(payload)
    new_release = RELEASES / manifest['sourceBuild'][:12]
    check(not new_release.exists() and not new_release.is_symlink(), 'TARGET_RELEASE_ALREADY_EXISTS')
    desired_proxy = base64.b64decode(payload['proxyBase64'], validate=True)
    original_proxy = PROXY.read_bytes()
    check(len(desired_proxy) < 65536 and AUTH_LINES <= {line.strip() for line in desired_proxy.decode().splitlines()}, 'AUTH_ROUTES_MISSING')
    check(strip_auth_routes(original_proxy.decode()) == strip_auth_routes(desired_proxy.decode()), 'PROXY_DIFF_EXCEEDS_AUTH_WHITELIST')
    report.update({'sourceBuild': manifest['sourceBuild'], 'archiveSha256': payload['archiveSha256'], 'newProxySha256': sha(desired_proxy),
                   'release': str(new_release), 'verifiedArchiveFiles': len(files)})
    if not report['apply']:
        report['result'] = 'validated-read-only-plan'
        return report
    expected = payload['expectedPlan']
    check(expected['before'] == before and expected['archiveSha256'] == report['archiveSha256'] and expected['newProxySha256'] == report['newProxySha256'], 'PREFLIGHT_CHANGED_REPLAN_REQUIRED')
    check(report['activeEpisodes'] == 0, 'ACTIVE_EPISODES_REFUSE_UPGRADE')
    token = payload.get('credential', '')
    check(isinstance(token, str) and re.fullmatch('[A-Za-z0-9._~+/-]{24,256}=*', token) is not None, 'PERSONAL_VERIFICATION_CREDENTIAL_REQUIRED')
    identity, _ = request('/api/v1/identity', token)
    check(identity.get('role') in ['operator', 'coordinator'], 'VERIFICATION_CREDENTIAL_ROLE')
    with pathlib.Path('/run/lock/coop-bench-auth-upgrade.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        check(snapshot() == before, 'STATE_CHANGED_BEFORE_UPGRADE')
        new_release.mkdir(mode=0o755)
        for name, content in files.items():
            path = new_release / name
            path.parent.mkdir(mode=0o755, parents=True, exist_ok=True)
            with path.open('xb') as file:
                file.write(content)
            path.chmod(0o644)
        backup_dir = pathlib.Path('/var/backups/coop-bench') / ('pre-auth-' + datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ') + '-' + uuid.uuid4().hex[:8])
        stopped = False
        switched = False
        proxy_changed = False
        try:
            command(['systemctl', 'stop', GAME_UNIT])
            stopped = True
            with connect_readonly(DATA / 'episodes.sqlite') as db:
                check(db.execute("SELECT count(*) FROM episodes WHERE status='active'").fetchone()[0] == 0, 'ACTIVE_EPISODE_CREATED_DURING_PREFLIGHT')
            old_databases = {name: database_snapshot(DATA / name) for name in databases()}
            report['preUpgradeBackup'] = {'directory': str(backup_dir), 'databases': backup_all(backup_dir)}
            (backup_dir / 'api-proxy.conf').write_bytes(original_proxy)
            (backup_dir / 'api-proxy.conf').chmod(0o600)
            (backup_dir / 'previous-release.txt').write_text(before['current'] + '\n')
            switch(new_release)
            switched = True
            atomic_proxy(desired_proxy)
            proxy_changed = True
            command(['/usr/sbin/nginx', '-t', '-c', str(PROXY)])
            command(['systemctl', 'start', GAME_UNIT])
            report['health'] = wait_health(manifest['sourceBuild'])
            command(['systemctl', 'reload', PROXY_UNIT])
            auth, _ = request('/api/v1/auth/status')
            check(auth.get('enabled') is True and auth.get('passwordLoginAvailable') is True, 'AUTH_NOT_ENABLED')
            account, _ = request('/api/v1/auth/account', token)
            check(account.get('userId') == identity.get('id'), 'PERSONAL_IDENTITY_CHANGED')
            report['auth'] = {'statusHttp': 200, 'accountHttp': 200, 'userId': account.get('userId'), 'passwordConfigured': account.get('passwordConfigured')}
            report['historicalReadChecks'] = []
            for episode_id in historical_ids:
                check(re.fullmatch('[A-Za-z0-9_-]+', episode_id) is not None, 'UNSAFE_EPISODE_ID')
                rollout, size = request('/api/v1/rollouts/' + episode_id, token)
                audit, audit_size = request('/api/v1/episodes/' + episode_id + '/audit', token)
                report['historicalReadChecks'].append({'episodeId': episode_id, 'rolloutHttp': 200, 'rolloutBytes': size, 'auditHttp': 200, 'auditBytes': audit_size})
            report['dataPreservation'] = {}
            for name, old in old_databases.items():
                after = database_snapshot(DATA / name)
                exact = preserved(old, after)
                report['dataPreservation'][name] = {'allOldRowsPreserved': True, 'exactTableContents': exact, 'before': summarize(old), 'after': summarize(after)}
            after = snapshot()
            check(after['protectedHashes'] == before['protectedHashes'], 'UNRELATED_CONFIGURATION_CHANGED')
            for name in ['nginx.service', 'reimbursement-api.service']:
                check(after['services'][name] == before['services'][name], 'UNRELATED_SERVICE_CHANGED')
            check(after['services'][PROXY_UNIT]['MainPID'] == before['services'][PROXY_UNIT]['MainPID'] and after['services'][PROXY_UNIT]['ActiveState'] == 'active', 'PROXY_MASTER_CHANGED')
            check(after['current'] == str(new_release) and after['proxySha256'] == sha(desired_proxy), 'RELEASE_OR_PROXY_CHANGED')
            check('human-auth.sqlite' in databases(), 'AUTH_DATABASE_NOT_CREATED')
            post_dir = backup_dir.with_name(backup_dir.name.replace('pre-auth-', 'post-auth-'))
            report['postUpgradeBackup'] = {'directory': str(post_dir), 'databases': backup_all(post_dir)}
            command(['systemctl', 'start', 'coop-bench-backup.service'], timeout=120)
            check(service('coop-bench-backup.service')['ActiveState'] == 'inactive', 'BACKUP_DID_NOT_FINISH')
            check(regular(pathlib.Path('/var/backups/coop-bench/human-auth/latest.sqlite')), 'SCHEDULED_AUTH_BACKUP_MISSING')
            report.update({'result': 'upgraded-auth-ready', 'after': after, 'scheduledGameAndAuthBackupVerified': True, 'historicalBuildsNotRewritten': True})
        except Exception:
            # Restore only the owned release pointer/proxy. Preserve all live DB
            # files and backups, including a newly created authentication DB.
            if stopped:
                command(['systemctl', 'stop', GAME_UNIT])
            if proxy_changed and sha(PROXY.read_bytes()) == sha(desired_proxy):
                atomic_proxy(original_proxy)
                command(['/usr/sbin/nginx', '-t', '-c', str(PROXY)])
                command(['systemctl', 'reload', PROXY_UNIT])
            if switched and CURRENT.resolve() == new_release:
                switch(pathlib.Path(before['current']))
            if stopped:
                command(['systemctl', 'start', GAME_UNIT])
            raise
    return report


if __name__ == '__main__':
    payload = json.loads(base64.b64decode(PAYLOAD_BASE64))
    try:
        result = main(payload)
        print(json.dumps(result))
    except Exception as error:
        # Fixed messages contain no response body, database value or credential.
        text = str(error)
        safe = text if re.fullmatch('[A-Z0-9_:/a-z. -]{1,220}', text) else type(error).__name__
        print(json.dumps({'result': 'upgrade-failed-no-database-restore', 'error': safe}))
        sys.exit(1)
