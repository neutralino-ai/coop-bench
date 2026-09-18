# Take Time engine source

`engine.ts` and `types.ts` were copied byte for byte from the original `take-time`
project in the same user workspace on 2026-09-18. They are project-authored code,
not copied publisher rules. Source paths and SHA-256 values are recorded in
`docs/vendor-lineage.json` at the repository root.

Coop Bench now imports these local files so another computer needs only this
repository. The move changes no game rules. The surrounding adapter still maps
private card identifiers deterministically for replay. Only Clock 1-1 is supported.

The source-build fingerprint changed format for portable path separators and
line endings. Do not relabel historical episodes with the new fingerprint or
skip `BUILD_MISMATCH`; replay an old episode with its original archived runtime.
