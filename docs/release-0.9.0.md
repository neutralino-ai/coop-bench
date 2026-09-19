# Coop Bench 0.9.0

## Changes

- Stateless Node API backed by PostgreSQL: atomic version-CAS state/events/receipts; shared invitation rooms, passwords and sessions; per-seat observations; permanent private model messages and chunked artifacts. The optional SQLite local application is preserved.
- True stdio MCP `rules / wait / act`, backed by the same HTTP player API. Credentials stay outside tool arguments. Stable pending requests survive runner restarts; pagination never skips undelivered events; long polling and SSE are both supported.
- Server-enforced 60-second required-decision windows remain fixed across invalid actions, reconnects and process restarts. Expired actions cannot beat a delayed sweeper. Official clocks are separate from benchmark truncation.
- Admin desktop prioritizes invitation rooms and compact replay, with per-seat missing/partial/sealed trajectory indicators. Player desktop supports invitation deep links, explicit human/model resume, connection feedback, readable actions, score and deadline display. Windows, Mac Intel and Apple Silicon build configurations share the package version.

## Evidence

Validation uses synthetic accounts and games, not production credentials. PostgreSQL tests run against a real local database; they cover competing API instances, 20 identical concurrent commands, atomic room starts, concurrent password changes and revocation, hidden observations, paging, deadline races, a killed process during an uncommitted write, ten real adapters and deterministic replay. Mechanical game policies are interface tests, not LLM performance results.

Windows local verification (2026-09-20, Node 24.21.0):

| Check | Result |
| --- | --- |
| Full test suite with real PostgreSQL enabled | **341 passed, 0 failed, 0 skipped** |
| PostgreSQL authority, API, authentication and room tests (included above) | **18 passed** |
| Packaged admin against SQLite / PostgreSQL | **46 / 46 passed** |
| Packaged Player against SQLite / PostgreSQL | **14 / 14 passed** |
| Packaged admin optional local mode | **14 passed** |
| Replay layout at 1280×800 and 1440×900 | Screenshots inspected; no document scrolling required |

Final packages were rebuilt after the runtime event-retention fix. Bundled engine build: `df1cf9a3efa36a3bfde9660a7eb1d8167058808ac4c61af8343d7514cf79b26e`.

| Windows installer | SHA-256 |
| --- | --- |
| `Coop-Bench-0.9.0-win-x64.exe` | `9a20d74936a2ff564337e91879482d190cec3c766811f2714962c4e87452e374` |
| `Coop-Bench-Player-0.9.0-win-x64.exe` | `dff025411eb237eaba4d1dddd27783b953744287ae3c41b35101eaa951d305d5` |

Raw evidence remains in ignored `artifacts/v09-release-tests.log`, `client-v09-packaged-{sqlite,pg}`, `player-v09-packaged-{sqlite,pg}` and `client-v09-packaged-local`. Real model traces and credentials are never committed. Mac Intel / Apple Silicon build jobs and a separate PostgreSQL CI job are configured; their live GitHub result is distinct from this Windows record. No physical Mac installation/Keychain acceptance is claimed here.

## Operation and limits

See [server setup and user administration](stateless-server.md), [MCP setup](mcp-player.md), and [player sessions](player-sessions.md). Windows installers are unsigned; Mac builds are not Apple-notarized. Native CI does not replace user-machine installation and Keychain tests.

This release does not automatically migrate or delete old SQLite databases, rewrite old build identities, modify production owner credentials, or upgrade the Tencent Cloud service. Keep the old service and backups until a separately validated migration is ready. Both clients preserve the existing configured backend URL.

The MCP bridge captures its tool traffic. Full model messages/reasoning require the provider-aware runner or a host transcript upload. Missing reasoning is displayed as missing, never reconstructed.
