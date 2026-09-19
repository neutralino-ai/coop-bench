# Stateless PostgreSQL server — 0.9.0

The API processes retain sockets and notification listeners only. PostgreSQL holds authoritative game state, per-seat observations, accepted and rejected commands, receipts, rooms, users, password verifiers, sessions, model messages and artifacts. Each game update uses revision-CAS. State, game events and the receipt commit together. Waiting for agents and calling models never holds a game transaction.

This supersedes the earlier dedicated-process-per-game proposal. The SQLite server remains available for local use; it is not a distributed PostgreSQL substitute. Game adapters and the existing v1 HTTP contract are reused, so both desktop clients connect to either backend.

## Run a server

Use Node 24.21+ and `pnpm install --frozen-lockfile`. Provision a PostgreSQL database and a restricted application role that owns its schema. Set `COOP_DATABASE_URL` and a private `COOP_ADMIN_TOKEN`; use `deploy/postgres.env.example` as a template. Then:

```sh
pnpm start:server
```

The listener binds **127.0.0.1:8788** by default; `PORT` changes the port. The database URL and credentials are never printed. Remote access uses the existing trusted HTTPS proxy boundary; changing to PostgreSQL does not open a public listener. `/api/v1/health` is the health endpoint. API-only is the default. Set `COOP_SERVE_WEB=1` only for the local audit web UI.

Initial bootstrap creates an `owner` operator whose personal credential is `COOP_ADMIN_TOKEN`. Import that credential into the desktop settings, then set a password. Alternatively, `COOP_USERS_FILE` supplies the existing hashed access-user schema on first startup. This file is **bootstrap-only**: restarting cannot resurrect a revoked credential or overwrite an existing password.

All replicas must use the same database, adapter build, budgets and trusted proxy configuration. A second instance can use a different loopback `PORT`; the reverse proxy can route requests to either instance without episode affinity. The database and reverse proxy remain shared dependencies; adding API replicas alone does not guarantee unlimited capacity or database availability.

## Revoke or update users

These explicit administrative commands connect through the private `COOP_DATABASE_URL`:

```sh
node scripts/postgres-users.mjs disable tester1
node scripts/postgres-users.mjs enable tester1
node scripts/postgres-users.mjs apply-file /private/path/access-users.json
```

`apply-file` updates only users named in the file; omitted users remain unchanged. To revoke one, set `disabled:true` or run `disable`. Changing a user's credential binding invalidates prior password sessions and requires password setup under the new personal credential. These commands print user IDs and roles, never credentials. The API rechecks current user policy on each request. No credentials are sent as model tool arguments.

## Protocol guarantees

- `revision`: internal database concurrency control only; never a player event counter.
- `updateCursor` / `nextCursor`: last **delivered** visible update for this seat. `hasMore` means another page is required; `headCursor`, when present, is not a continuation cursor.
- `decisionToken`: permission to act against this seat's current decision context. A delayed action from a previous decision cannot apply to a later round.
- `Idempotency-Key`: stable per intent, scoped to episode and seat, with a request fingerprint. A changed request under an existing key is rejected. System events have explicit kinds.
- Required decisions have a persistent 60-second deadline. Chat, malformed requests, rejections and reconnects never renew it. Deadline checks occur on submission even before a background timeout sweep. Official game clocks and benchmark truncation remain distinct.
- Setup uses the requested seed independently of episode ID. Replays require the pinned adapter build. Historical audit does not reinterpret an old game using a new build.
- PostgreSQL `NOTIFY` wakes pending reads after commit. Dedicated LISTEN reconnect and periodic reconciliation recover missed notifications. Sockets are disposable; persisted cursors resume the stream. Slow/disconnected clients do not hold database connections.
- Two simultaneous waits and two SSE streams per seat are allowed per API instance, with bounded total sockets. These resource caps are not a claim of global distributed request rate limiting. Password-attempt budgets are shared in PostgreSQL.

## Player transports and clients

Agent and human players share the same seat authorization. The player interface is `rules`, `wait`, `act`; room create/join/ready/start/kick are separate. See [MCP player](mcp-player.md), [player sessions](player-sessions.md) and [PLAY.md](../PLAY.md).

The admin desktop selects games, creates invitation rooms and audits compact replays. The separate Player desktop joins an invitation, plays manually, or runs a model configured with API key, base URL and model name. The headless runner remains supported. Model credentials stay local to the runtime; they are not game-server credentials.

## Evidence and retention

Game evidence commits transactionally; raw provider/tool messages upload through the private per-seat message stream. Artifacts support bounded chunks and integrity verification. Upload retries do not advance the game or extend its deadline. A model record is client-supplied evidence, not proof that the host had no other tools. Missing, partial and sealed streams remain distinguishable in the UI. Provider-exposed reasoning, summaries, encrypted fields and unavailable hidden reasoning must not be conflated.

PostgreSQL currently stores artifact bytes as chunked `bytea` rows, keeping this release operational with one persistence system. Back up the whole database, including evidence and authentication tables. No automatic history pruning is introduced; limits reject new writes. Object storage can be added later without changing the player API.

## Validation and rollout

`pnpm test:postgres` starts a real isolated PostgreSQL bound to loopback and runs the PostgreSQL integration suites. It leaves its test cluster in ignored `artifacts/` for diagnosis and stops the process afterwards. Alternatively set `COOP_TEST_DATABASE_URL` to a **dedicated test database** and run `node --test test/postgres*.test.ts`. Never point tests at production.

Existing SQLite files are not automatically converted or deleted. The current cloud service must be backed up and migrated separately before switching production clients; starting this entrypoint against a fresh database does not import previous episodes or passwords. The default desktop API address is unchanged. See release notes for exactly which local/package/CI checks were run; a successful Windows build does not establish Mac installation or Keychain acceptance.
