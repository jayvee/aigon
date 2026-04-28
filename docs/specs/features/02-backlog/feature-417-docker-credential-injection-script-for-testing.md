---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:10:33.304Z", actor: "cli/feature-prioritise" }
---

# Feature: docker credential injection script for testing

## Summary
Add `scripts/docker-inject-creds.sh` — a one-command helper that copies host agent credentials into a running clean-room Docker container. Today, testing the onboarding wizard end-to-end requires manually authenticating Claude Code, Gemini, Codex, and GitHub inside the container, which takes 10–15 minutes per run. This script reduces that to ~5 seconds by tar-piping the relevant credential directories from the host into the container after startup but before the Brewboard test run. Also adds a "Skip auth during testing" section to `docker/clean-room/README.md`.

## User Stories
- [ ] As a developer running Docker-based onboarding tests, I run `bash scripts/docker-inject-creds.sh <container_id>` after starting the container and all agent auth steps are pre-populated so I can proceed directly to testing Brewboard.
- [ ] As a developer who only has some agents installed (e.g. Claude but not Codex), the script copies what exists and silently skips what doesn't, with a clear summary of what was copied vs skipped.

## Acceptance Criteria
- [ ] `bash scripts/docker-inject-creds.sh` with no args prints usage and exits non-zero
- [ ] `bash scripts/docker-inject-creds.sh <id>` with a non-running container prints a clear error and exits non-zero
- [ ] Running the script against a live container copies all present credential paths and skips absent ones without erroring
- [ ] After injection, `claude --version` and `gh auth status` succeed inside the container without re-auth
- [ ] Script is idempotent — running it twice doesn't break anything
- [ ] `docker/clean-room/README.md` documents the script in a "Skip auth during testing" section

## Validation
```bash
bash -n scripts/docker-inject-creds.sh
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### `scripts/docker-inject-creds.sh`

Script accepts `<container_id>` as `$1`. Checks it's running via `docker inspect`. Iterates over credential source paths, builds a tar include list of those that exist on the host, pipes them into the container home directory. Prints a per-entry copy/skip summary.

Credential paths to copy (host `~` → container `~`):

| Path | Agent | Notes |
|---|---|---|
| `.claude.json` | Claude Code | auth token |
| `.claude/` | Claude Code | project trust + sessions |
| `.gemini/` | Gemini | OAuth tokens + trusted folders |
| `.codex/config.toml` | Codex | API key config only (not sessions) |
| `.config/gh/` | GitHub CLI | gh auth token |

Method: `tar -czf - -C "$HOME" "${paths[@]}" | docker exec -i "$CONTAINER_ID" bash -c 'cd ~ && tar -xzf -'`

Key decisions:
- `tar` pipe avoids any intermediate files
- Only `.codex/config.toml` (not full `.codex/`) to avoid injecting stale session state
- `mkdir -p ~/.codex ~/.config/gh` run in container first to ensure parent dirs exist
- Missing paths are skipped silently with a `- skipped:` line in output, not errored

### README update
Add a "Skip auth during testing" section to `docker/clean-room/README.md` documenting the three-step flow: start container → inject creds → run `aigon setup`.

## Dependencies
- none

## Out of Scope
- Cursor credential injection — Cursor uses macOS `~/Library/Application Support/Cursor/` which doesn't map into the Linux container
- Automated credential refresh / token rotation
- CI/CD secret injection (separate concern; use `run.sh` env var forwarding for that)
- Handling `OPENAI_API_KEY` / `GOOGLE_API_KEY` — already covered by `run.sh` `--env` flags

## Open Questions
- none

## Related
- Research: none
- Set: onboarding-improvements
