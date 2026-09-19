#!/bin/sh
set -eu
# Run as postgres using local Unix socket peer authentication. The archive
# includes all game, evidence, artifact, user, password and session tables.
# No backup pruning; provision disk monitoring and copy backups off-host.
umask 077
directory=/var/backups/coop-bench-v09
test -d "$directory"
test ! -L "$directory"
stamp=$(date -u +%Y%m%dT%H%M%SZ)
pending=$(mktemp "$directory/.pending-XXXXXXXX.dump")
trap 'rm -f -- "$pending"' EXIT HUP INT TERM
pg_dump --host=/var/run/postgresql --username=postgres --dbname=coop_bench_v09 --format=custom --no-owner --no-acl --file="$pending"
pg_restore --list "$pending" >/dev/null
destination="$directory/coop-bench-v09-$stamp-$$.dump"
test ! -e "$destination"
mv -- "$pending" "$destination"
sha256sum "$destination" > "$destination.sha256"
printf 'Full PostgreSQL backup completed: %s\n' "$destination"
