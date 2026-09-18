"""Install only three new, scoped files; never rewrite global nginx or the game DB."""
import base64
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys
import time

payload = json.loads(base64.b64decode(PAYLOAD_BASE64))
unit = 'coop-bench-api-proxy.service'
paths = {
    '/etc/coop-bench/api-proxy.conf': ('nginx-api34935.conf', 0o644),
    '/etc/systemd/system/' + unit: ('coop-bench-api-proxy.service', 0o644),
    '/etc/letsencrypt/renewal-hooks/deploy/coop-bench-api-proxy': ('renew-api34935.sh', 0o755),
}

def run(args, timeout=20):
    p = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
    return {'code': p.returncode, 'stdout': p.stdout.strip(), 'stderr': p.stderr.strip()}

def required(args):
    result = run(args)
    if result['code']:
        raise RuntimeError(json.dumps({'command': args, **result}))
    return result

def status(name):
    return run(['systemctl', 'is-active', name])['stdout']

def snapshot():
    originals = ['/etc/nginx/nginx.conf', '/etc/nginx/sites-available/coop-bench',
                 '/etc/nginx/sites-available/up-the-chain', '/etc/reimbursement/nginx-api.conf',
                 '/etc/systemd/system/reimbursement-api.service']
    return {
        'configHashes': {p: hashlib.sha256(pathlib.Path(p).read_bytes()).hexdigest() for p in originals if pathlib.Path(p).is_file()},
        'services': {name: status(name) for name in ['nginx', 'coop-bench', 'reimbursement-api']},
        'gameMainPid': required(['systemctl', 'show', 'coop-bench', '--property=MainPID', '--value'])['stdout'],
        'reimbursementMainPid': required(['systemctl', 'show', 'reimbursement-api', '--property=MainPID', '--value'])['stdout'],
    }

def ports():
    result = required(['ss', '-H', '-ltn'])['stdout'].splitlines()
    return sorted({int(line.split()[3].rsplit(':', 1)[1]) for line in result})

report = {'at': datetime.datetime.now(datetime.timezone.utc).isoformat(), 'apply': payload['apply'], 'before': snapshot(), 'portsBefore': ports()}
assert report['before']['services']['coop-bench'] == 'active', 'GAME_BACKEND_NOT_ACTIVE'
assert report['before']['services']['nginx'] == 'inactive', 'GLOBAL_NGINX_STATE_CHANGED'
assert not any(p in report['portsBefore'] for p in [80, 34935]), 'PORT_ALREADY_OCCUPIED'
assert all(not pathlib.Path(p).exists() and not pathlib.Path(p).is_symlink() for p in paths), 'SCOPED_FILE_ALREADY_EXISTS'
assert set(payload['files']) == {value[0] for value in paths.values()}, 'INVALID_MANIFEST'
assert pathlib.Path('/etc/letsencrypt/live/coop.neutrinophysics.cn/fullchain.pem').is_file(), 'CERTIFICATE_MISSING'
report['files'] = {target: {'sha256': hashlib.sha256(base64.b64decode(payload['files'][name])).hexdigest(), 'mode': oct(mode)} for target, (name, mode) in paths.items()}
if not payload['apply']:
    report['result'] = 'ready-to-install'
    print(json.dumps(report))
    sys.exit(0)

created = []
try:
    for target, (name, mode) in paths.items():
        path = pathlib.Path(target)
        assert path.parent.is_dir(), 'EXPECTED_DIRECTORY_MISSING'
        content = base64.b64decode(payload['files'][name])
        with path.open('xb') as file:
            file.write(content)
        path.chmod(mode)
        created.append(path)
    required(['systemctl', 'daemon-reload'])
    # ExecStartPre performs nginx -t after systemd creates its RuntimeDirectory.
    required(['systemctl', 'start', unit])
    for _ in range(30):
        if 34935 in ports() and 80 in ports():
            break
        time.sleep(0.1)
    assert status(unit) == 'active' and all(p in ports() for p in [80, 34935]), 'PROXY_NOT_LISTENING'
    report['configTest'] = required(['/usr/sbin/nginx', '-t', '-c', '/etc/coop-bench/api-proxy.conf'])
    report['after'] = snapshot()
    assert report['before'] == report['after'], 'UNRELATED_STATE_CHANGED'
    required(['systemctl', 'enable', unit])
    report.update({'result': 'installed-active-enabled', 'portsAfter': ports(), 'enabled': required(['systemctl', 'is-enabled', unit])['stdout'], 'unrelatedStatePreserved': True})
except Exception as error:
    # Only remove files whose exact bytes still match what this attempt created.
    run(['systemctl', 'disable', '--now', unit])
    rollback = []
    for path in reversed(created):
        if path.is_file() and not path.is_symlink() and hashlib.sha256(path.read_bytes()).hexdigest() == report['files'][str(path)]['sha256']:
            path.unlink()
            rollback.append(str(path))
    run(['systemctl', 'daemon-reload'])
    report.update({'result': 'failed-rolled-back-owned-files', 'error': str(error), 'removedOwnedFiles': rollback})
    print(json.dumps(report))
    sys.exit(1)
print(json.dumps(report))
