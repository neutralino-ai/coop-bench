#!/usr/bin/env bash
set -euo pipefail
# Pinned, reviewed update for the already-installed user-authorized host.
stage=/home/ubuntu/coop-bench-stage-artifacts
release_id=16a27ba4d7f9
build=16a27ba4d7f92a66e87ff780c70872c3af46a57ffd897616b4070607f01ab7e5
archive="$stage/coop-bench-$release_id.tar.gz"
expected=0e564fe123a2cef6573192b992c39db7c90fff23cf3c1f26e61809847a2f4047
release="/opt/coop-bench/releases/$release_id"
previous=$(readlink -f /opt/coop-bench/current)
test "$previous" = /opt/coop-bench/releases/4a3f1b78705d
test "$(sha256sum "$archive" | cut -d ' ' -f1)" = "$expected"
test ! -e "$release"
install -d -m 0755 "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
chown -R root:root "$release"
install -d -m 0700 /var/backups/coop-bench /var/backups/coop-bench/pre-artifacts-20260917

stopped=0
switched=0
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$stopped" -eq 1 ]; then
    if [ "$switched" -eq 1 ]; then
      ln -s "$previous" /opt/coop-bench/rollback.next
      mv -Tf /opt/coop-bench/rollback.next /opt/coop-bench/current
    fi
    systemctl start coop-bench
  fi
  exit "$rc"
}
trap rollback EXIT
systemctl stop coop-bench
stopped=1
# Refuse to invalidate an in-progress game during a build migration.
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/coop-bench/episodes.sqlite?mode=ro',uri=True)
assert db.execute("SELECT COUNT(*) FROM episodes WHERE status='active'").fetchone()[0]==0, 'Active games exist; retaining prior release.'
print({'beforeEpisodes':db.execute('SELECT COUNT(*) FROM episodes').fetchone()[0], 'beforeEvents':db.execute('SELECT COUNT(*) FROM events').fetchone()[0]})
db.close()
PY
/opt/coop-bench-node/bin/node "$release/app/scripts/backup-server.mjs" /var/lib/coop-bench/episodes.sqlite /var/backups/coop-bench/pre-artifacts-20260917
ln -s "$release" /opt/coop-bench/current.next
mv -Tf /opt/coop-bench/current.next /opt/coop-bench/current
switched=1
systemctl start coop-bench
for attempt in $(seq 1 20); do
  if curl --silent --fail http://127.0.0.1:8788/health > "$stage/health.json"; then break; fi
  sleep 0.25
done
python3 - "$stage/health.json" "$build" <<'PY'
import json,sys
health=json.load(open(sys.argv[1]))
assert health['ok'] and health['build']==sys.argv[2], 'New build health verification failed'
print(health)
PY
install -m 0644 "$release/deploy/coop-bench-backup.service" /etc/systemd/system/coop-bench-backup.service
install -m 0644 "$release/deploy/coop-bench-backup.timer" /etc/systemd/system/coop-bench-backup.timer
systemd-analyze verify /etc/systemd/system/coop-bench-backup.service /etc/systemd/system/coop-bench-backup.timer
systemctl daemon-reload
systemctl enable --now coop-bench-backup.timer
systemctl start coop-bench-backup.service
cat /var/backups/coop-bench/latest.json
systemctl is-active coop-bench coop-bench-backup.timer
stopped=0
trap - EXIT
