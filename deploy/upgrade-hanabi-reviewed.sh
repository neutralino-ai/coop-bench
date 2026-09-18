#!/usr/bin/env bash
set -euo pipefail
# Pinned update of the existing user-authorized application only.
stage=/home/ubuntu/coop-bench-stage-hanabi
release_id=0118c12eddcc
build=0118c12eddcc6b15045ddacb3d7599ecba02d79d29b0e738b3d5896080bb796d
archive="$stage/coop-bench-$release_id.tar.gz"
expected=2ba264410b1941f8d54aa43b7970ef2d17e0b1414ab5ef2ad2d06743ba59d951
release="/opt/coop-bench/releases/$release_id"
previous=$(readlink -f /opt/coop-bench/current)
test "$previous" = /opt/coop-bench/releases/b8706e22277d
test "$(sha256sum "$archive" | cut -d ' ' -f1)" = "$expected"
test ! -e "$release"
install -d -m 0755 "$release"
tar --no-same-owner -xzf "$archive" -C "$release"
chown -R root:root "$release"
install -d -m 0700 /var/backups/coop-bench/pre-hanabi-20260917
stopped=0
switched=0
rollback() {
  rc=$?
  if [ "$rc" -ne 0 ] && [ "$stopped" -eq 1 ]; then
    if [ "$switched" -eq 1 ]; then
      ln -s "$previous" /opt/coop-bench/rollback-hanabi.next
      mv -Tf /opt/coop-bench/rollback-hanabi.next /opt/coop-bench/current
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
/opt/coop-bench-node/bin/node "$release/app/scripts/backup-server.mjs" /var/lib/coop-bench/episodes.sqlite /var/backups/coop-bench/pre-hanabi-20260917
ln -s "$release" /opt/coop-bench/current-hanabi.next
mv -Tf /opt/coop-bench/current-hanabi.next /opt/coop-bench/current
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
python3 "$stage/verify-hanabi-retention.py"
systemctl is-active coop-bench coop-bench-backup.timer
stopped=0
trap - EXIT
