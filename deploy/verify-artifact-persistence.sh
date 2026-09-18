#!/usr/bin/env bash
set -euo pipefail
test "$(readlink -f /opt/coop-bench/current)" = /opt/coop-bench/releases/16a27ba4d7f9
python3 - <<'PY'
import sqlite3
db=sqlite3.connect('file:/var/lib/coop-bench/episodes.sqlite?mode=ro',uri=True)
assert db.execute("SELECT COUNT(*) FROM episodes WHERE status='active'").fetchone()[0]==0, 'Do not restart during an active game.'
assert db.execute("SELECT COUNT(*) FROM artifacts WHERE status='complete'").fetchone()[0]==3, 'Wait for all three player uploads.'
db.close()
PY
systemctl restart coop-bench
for attempt in $(seq 1 20); do
  if curl --silent --fail http://127.0.0.1:8788/health > /home/ubuntu/coop-bench-stage-artifacts/restarted-health.json; then break; fi
  sleep 0.25
done
python3 - <<'PY'
import json
state=json.load(open('/home/ubuntu/coop-bench-stage-artifacts/restarted-health.json'))
assert state['ok'] and state['build']=='16a27ba4d7f92a66e87ff780c70872c3af46a57ffd897616b4070607f01ab7e5'
PY
systemctl start coop-bench-backup.service
python3 /home/ubuntu/coop-bench-stage-artifacts/verify-cloud-retention.py > /home/ubuntu/coop-bench-stage-artifacts/retention-verification.json
cat /home/ubuntu/coop-bench-stage-artifacts/retention-verification.json
