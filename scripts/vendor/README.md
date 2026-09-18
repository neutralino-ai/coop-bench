# Shared cloud helpers

These are original utilities from the same user's `ipv6-ddns-desktop` project.
They are copied into this repository to remove a sibling checkout dependency.

- `env-file.mjs` is byte-for-byte unchanged. It parses literal assignments without
  executing shell commands or expanding variables.
- `tc3.mjs` retains the original pure `signTc3` function and its constants. The DNS
  client and record-writing functions were not included because these deployment
  scripts need only request signing.

See `docs/vendor-lineage.json` for hashes. No credentials or environment files are
included. Deployment scripts still require explicitly provided local credentials
and infrastructure access; cloning or building does not execute them.
