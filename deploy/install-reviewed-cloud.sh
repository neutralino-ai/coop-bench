#!/usr/bin/env bash
set -euo pipefail
# First-install script for the inspected Ubuntu host. Does not alter nginx/firewall.
stage="$HOME/coop-bench-stage-20260917"
archive="$stage/coop-bench-4a3f1b78705d.tar.gz"
test "$(uname -m)" = x86_64
test ! -e /etc/systemd/system/coop-bench.service
test ! -e /opt/coop-bench-node
test -f "$archive"
cd "$stage"
sha256sum -c coop-bench-4a3f1b78705d.tar.gz.sha256
curl --fail --location --max-time 90 --output node.tar.xz https://nodejs.org/dist/v24.21.0/node-v24.21.0-linux-x64.tar.xz
curl --fail --location --max-time 30 --output SHASUMS256.txt https://nodejs.org/dist/v24.21.0/SHASUMS256.txt
expected=$(awk '$2 == "node-v24.21.0-linux-x64.tar.xz" {print $1}' SHASUMS256.txt)
test "${#expected}" -eq 64
printf '%s  node.tar.xz\n' "$expected" | sha256sum -c -
if ! getent passwd coop-bench >/dev/null; then sudo useradd --system --home-dir /var/lib/coop-bench --shell /usr/sbin/nologin coop-bench; fi
sudo install -d -m 0755 /opt/coop-bench-node /opt/coop-bench/releases/4a3f1b78705d
sudo tar -xJf node.tar.xz --strip-components=1 -C /opt/coop-bench-node
sudo tar -xzf "$archive" -C /opt/coop-bench/releases/4a3f1b78705d
sudo chown -R root:root /opt/coop-bench-node /opt/coop-bench/releases/4a3f1b78705d
sudo ln -s releases/4a3f1b78705d /opt/coop-bench/current
sudo install -d -m 0750 -o root -g coop-bench /etc/coop-bench
sudo install -m 0640 -o root -g coop-bench access-users.json /etc/coop-bench/access-users.json
sudo install -d -m 0700 -o coop-bench -g coop-bench /var/lib/coop-bench
printf '%s\n' NODE_ENV=production PORT=8788 COOP_DATA_DIR=/var/lib/coop-bench COOP_USERS_FILE=/etc/coop-bench/access-users.json | sudo tee /etc/coop-bench/coop-bench.env >/dev/null
sudo chmod 0600 /etc/coop-bench/coop-bench.env
sudo install -m 0644 /opt/coop-bench/current/deploy/coop-bench.service /etc/systemd/system/coop-bench.service
sudo install -m 0644 /opt/coop-bench/current/deploy/journald-coop-bench.conf /etc/systemd/journald@coop-bench.conf
sudo systemd-analyze verify /etc/systemd/system/coop-bench.service
sudo systemctl daemon-reload
sudo systemctl enable --now coop-bench.service
for attempt in $(seq 1 20); do
  if curl --fail --silent http://127.0.0.1:8788/health > "$stage/health.json"; then break; fi
  sleep 1
done
curl --fail --silent http://127.0.0.1:8788/health
printf '\n'
sudo systemctl show coop-bench -p User -p ActiveState -p SubState -p MemoryMax -p NoNewPrivileges
ss -ltn 'sport = :8788'
/opt/coop-bench-node/bin/node --version
