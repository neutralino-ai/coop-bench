#!/usr/bin/env bash
set -euo pipefail
# Pinned update of the existing user-authorized application only.
stage=/home/ubuntu/coop-bench-stage-messages
release_id=b8706e22277d
build=b8706e22277dd4b68cb14e6d2cf9407caf353af1151de2b00781c5c6d94ab8a7
archive="$stage/coop-bench-$release_id.tar.gz"
expected=7478ccc403e328a5bba4698dade51552ce37587447370c02e375c2804441369e
release="/opt/coop-bench/releases/$release_id"
previous=$(readlink -f /opt/coop-bench/current)
test "$previous" = /opt/coop-bench/releases/16a27ba4d7f9
test "$(sha256sum "$archive" | cut -d ' ' -f1)" = "$expected"
test ! -e "$release"
install -d -m 0755 "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
chown -R root:root "$release"
install -d -m 0700 /var/backups/coop-bench/pre-messages-20260917
stopped=0
switched=0
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$stopped" -eq 1 ]; then
    if [ "$switched" -eq 1 ]; then
      ln -s "$previous" /opt/coop-bench/rollback-messages.next
      mv -Tf /opt/coop-bench/rollback-messages.next /opt/coop-bench/current
    fi
    systemctl restart coop-bench
  fi
  exit "$rc"
}
trap rollback EXIT
systemctl stop coop-bench
stopped=1
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/coop-bench/episodes.sqlite?mode=ro',uri=True)
assert db.execute("SELECT COUNT(*) FROM episodes WHERE status='active'").fetchone()[0]==0, 'Active games exist; retaining prior release.'
print({'beforeEpisodes':db.execute('SELECT COUNT(*) FROM episodes').fetchone()[0], 'beforeArtifacts':db.execute('SELECT COUNT(*) FROM artifacts').fetchone()[0]})
db.close()
PY
/opt/coop-bench-node/bin/node "$release/app/scripts/backup-server.mjs" /var/lib/coop-bench/episodes.sqlite /var/backups/coop-bench/pre-messages-20260917
ln -s "$release" /opt/coop-bench/current-messages.next
mv -Tf /opt/coop-bench/current-messages.next /opt/coop-bench/current
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
systemctl start coop-bench-backup.service
python3 "$stage/verify-message-retention.py"
systemctl is-active coop-bench coop-bench-backup.timer
stopped=0
trap - EXIT
