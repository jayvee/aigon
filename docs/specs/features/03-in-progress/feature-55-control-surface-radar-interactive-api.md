# Feature: control-surface-radar-interactive-api

## Summary
Add a mutation API to Radar so control surfaces (dashboard, VS Code extension, future native clients) can trigger core workflow actions through HTTP instead of copy/pasting CLI commands. This keeps Radar as the control plane while preserving existing CLI behavior.

## User Stories
- [ ] As an operator using a Radar client, I can trigger core feature workflow actions via an API call.
- [ ] As a maintainer, I can trust that Radar mutation endpoints are constrained to safe allowlisted actions and registered repos.

## Acceptance Criteria
- [ ] Radar exposes a `POST /api/action` endpoint that accepts `{ action, args, repoPath }`.
- [ ] The endpoint only permits an allowlisted set of actions and rejects unknown actions with a clear 400 response.
- [ ] The endpoint requires `repoPath` to be registered when multiple repos exist, and rejects unregistered repos.
- [ ] Successful action calls run Aigon CLI in the target repo and return structured result payload including stdout/stderr and exit code.
- [ ] Unit tests cover action parsing/validation and command argument construction.

## Validation
```bash
npm test
```

## Technical Approach
- Add reusable Radar action helpers in `lib/utils.js`:
  - Allowlist of supported mutation actions.
  - Repo resolution/validation against Radar's registered repos.
  - Request parsing and normalized argument handling.
  - Safe command invocation via `spawnSync(process.execPath, [aigon-cli.js, ...])` (no shell interpolation).
- Wire `POST /api/action` into `runRadarServiceDaemon`.
- Re-export helpers via `lib/dashboard.js` for targeted unit testing.
- Add tests in `aigon-cli.test.js` for parser/validation behavior and CLI arg building.

## Dependencies
- Feature 45 (Radar service/API foundation).

## Out of Scope
- Dashboard UI wiring for mutation buttons.
- WebSocket/session stream transport.
- Authentication/authorization hardening beyond local allowlist + repo guardrails.

## Open Questions
- Should Radar mutation endpoints require an explicit local auth token before enabling non-read actions?
- Should action APIs evolve from generic `action + args` to typed endpoints per workflow step?

## Related
- Research:
  - `docs/specs/research-topics/logs/research-09-cx-findings.md` (`radar-control-actions` recommendation)
