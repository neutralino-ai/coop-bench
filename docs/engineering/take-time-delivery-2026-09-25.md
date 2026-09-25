# Take Time player and replay delivery

Branch `codex/take-time-campaign`, based on main `d53189c`. Use the containing commit/PR for the exact revision. This is client implementation and local acceptance evidence, not a released app version.

Creation now uses server catalog descriptions and setup capabilities for clock selection, retry bonus and Rebirth options. A shared renderer displays six numbered destinations, moving rules/pointers, public backs, own hand, current actor, discussion, face-up quota and final conditions. Humans select, preview and confirm a current API action; optional private reasons are folded away by default. The existing built-in model, reason, raw-response recorder and recovery protocol is reused. Replay reads recorded projections and never fills an earlier unknown number with a later reveal. No rules engine or publisher artwork is bundled.

## Executed checks

- Node 24.21.0 repository policy, zero-warning ESLint and strict TypeScript checks passed.
- All 132 existing client tests passed, with no skips. These retain runtime/replay/trace/seat-boundary regressions.
- `electron scripts/test-take-time-ui.cjs` passed 13 groups of real-render checks using synthetic observations: stable seats, legal selection, preview/confirmation, one current-observation submission with private human reason, waiting actor, rules, opaque replay, escaped discussion, opaque transfer, 390 px overflow, rejection recovery, terminal conditions and setup serialization/old-server fallback. Six desktop/phone screenshots were inspected. The fixture IPC emits one expected rejection error to verify recovery. This test is also required by each desktop CI job.
- Actual public `PlayerRuntime` and `MinimalAgent` were exercised against the local private server with a synthetic provider: a human interface and two model seats completed VII-4 (27 accepted actions, long polling) and X-4 (15, SSE); replay and stored reasons/actual provider responses passed. The test uses legal-action examples, not a competitive strategy. It does not demonstrate real model puzzle-solving performance.
- Local client runtime build and shared iOS asset generation passed. Clean-source checks are run after committing; the allowlist includes the new rendering assets.

Local screenshots/reports are ignored under `artifacts/take-time-ui/`. The new Electron test runs sandboxed with context isolation and a synthetic preload. Server rules and data remain remote; both desktop and iOS bridges already forward optional private reasons.

## Release limits

No production deployment, app version bump, signed native package, TestFlight upload or physical-device acceptance is claimed. Shared web rendering is not proof of iOS WebKit or native builds; those remain PR CI/release checks. The host chooses each clock and retry bonus; persistent account campaign progression is not implemented.
