---
commit_count: 2
lines_added: 134
lines_removed: 9
lines_changed: 143
files_touched: 5
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
model: "cursor"
source: "no-telemetry-cursor"
---
# Implementation Log: Feature 417 - docker-credential-injection-script-for-testing
Agent: cu

## Status

Implemented `scripts/docker-inject-creds.sh` (tar stream into `docker exec -u dev`) and documented the flow in `docker/clean-room/README.md` under **Skip auth during testing**. Regression coverage in `tests/integration/static-guards.test.js` (`bash -n` + no-arg exit).

## New API Surface

- `scripts/docker-inject-creds.sh <container_id>` — host-only helper; not wired into npm CLI.

## Key Decisions

- `docker exec -u dev` so files land in `/home/dev` (plain `docker exec` runs as root).
- Credential list matches spec table; only `.codex/config.toml`, not full `~/.codex/`.
- Inner command `mkdir -p .codex .config/gh` before `tar -xzf -` for stable extracts.

## Gotchas / Known Issues

- Live verification ( `claude --version` / `gh auth status` in container) requires a running clean-room container and host credentials present — manual.

## Explicitly Deferred

- none

## For the Next Feature in This Set

- none

## Test Coverage

- `tests/integration/static-guards.test.js` — `bash -n`, no-args non-zero + Usage string.
