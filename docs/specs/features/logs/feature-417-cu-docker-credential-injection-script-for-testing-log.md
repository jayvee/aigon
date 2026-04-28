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
