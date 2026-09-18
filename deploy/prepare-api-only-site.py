"""Prepare the existing stopped Nginx site for the requested API-only game entry.
Preserves unrelated locations (including reimbursement), TLS, and ACME settings.
Never starts or reloads Nginx. No credentials or database content are read.
"""
import datetime
import hashlib
import json
import pathlib
import subprocess
import sys

site = pathlib.Path('/etc/nginx/sites-available/coop-bench')
fragment = pathlib.Path(__file__).with_name('nginx-api-only.conf').read_text()
state = subprocess.run(['systemctl', 'is-active', 'nginx'], capture_output=True, text=True).stdout.strip()
if state != 'inactive':
    raise SystemExit('Expected the observed inactive Nginx service; inspect state drift before editing.')
original = site.read_text()
start = original.find('    location / {\n        limit_req zone=coop_requests')
if start < 0:
    raise SystemExit('Reviewed game proxy block was not found; no changes made.')
end = original.find('\n    }', start) + len('\n    }')
old = original[start:end]
if old.count('proxy_pass http://127.0.0.1:8788;') != 1 or old.count('{') != 1 or old.count('}') != 1:
    raise SystemExit('Unexpected proxy block; no changes made.')
replacement = '\n'.join('    ' + line if line else '' for line in fragment.splitlines())
updated = original[:start] + replacement + original[end:]
assert 'location ^~ /reimbursement/' in updated
assert 'location ^~ /.well-known/acme-challenge/' in updated
assert original.count('ssl_certificate_key') == updated.count('ssl_certificate_key') == 1
if '--apply' not in sys.argv:
    print(updated)
    raise SystemExit(0)
stamp = datetime.datetime.now(datetime.timezone.utc).strftime('%Y%m%dT%H%M%SZ')
backup = site.with_name('coop-bench.before-client-' + stamp)
with backup.open('x') as file:
    file.write(original)
backup.chmod(0o600)
temp = site.with_name('coop-bench.client-new')
try:
    with temp.open('x') as file:
        file.write(updated)
    temp.chmod(site.stat().st_mode & 0o777)
    temp.replace(site)
    result = subprocess.run(['nginx', '-t'], capture_output=True, text=True)
    if result.returncode != 0:
        site.write_text(original)
        raise RuntimeError('nginx -t failed; original configuration restored: ' + result.stderr)
finally:
    if temp.exists():
        temp.unlink()
after = subprocess.run(['systemctl', 'is-active', 'nginx'], capture_output=True, text=True).stdout.strip()
assert after == 'inactive'
print(json.dumps({'at': stamp, 'site': str(site), 'backup': str(backup), 'nginxBefore': state,
    'nginxAfter': after, 'configTest': 'passed', 'gameWebEntry': 'disabled-in-prepared-config',
    'productionApiPubliclyStarted': False, 'unrelatedLocationsPreserved': True,
    'beforeSha256': hashlib.sha256(original.encode()).hexdigest(),
    'afterSha256': hashlib.sha256(updated.encode()).hexdigest()}, indent=2))
