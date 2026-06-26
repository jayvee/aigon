---
complexity: medium
set: instance-isolation
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:57:20.496Z", actor: "cli/feature-prioritise" }
---

# Feature: sandboxed preview for backend changes

## Summary
The worktree preview launcher (Scenario A) runs a worktree's modified code, which
already covers UI changes and *read-only* backend changes for free. But a
worktree whose backend changes **write** state — mutating `~/.aigon`, workflow
snapshots, or repo spec/lifecycle state — must not be previewed against your real
data, because in-progress code could corrupt it. This feature adds a
`--sandbox` mode to the preview launcher: it runs the worktree's dashboard against
an **isolated, seeded profile** (throwaway `AIGON_HOME` + a copied/seeded
fixture repo) so you can exercise experimental backend behaviour with zero
blast-radius on your live state.

The recipe already exists, in the e2e bootstrap — this feature productises it as a
user-facing preview mode rather than a test-only path.

## User Stories
- [ ] As a developer, I can preview a worktree whose backend changes mutate state, knowing it runs against a disposable copy and cannot touch my real `~/.aigon` or repo state.
- [ ] As a developer, I can click through workflow actions (start/prioritise/close, etc.) in a sandboxed preview to exercise the new backend end-to-end, and discard the sandbox afterwards.
- [ ] As a developer, I can choose between a fast empty-ish seed and a richer fixture so the sandbox reflects realistic data.

## Acceptance Criteria
- [ ] `aigon preview <feature-id> --sandbox` launches the worktree's dashboard with an isolated `AIGON_HOME` (throwaway profile dir) and a seeded copy of a fixture repo, so all writes land in the sandbox.
- [ ] No file under the real `~/.aigon` or the user's real project repo is created, modified, or deleted by a sandboxed preview.
- [ ] The sandbox-creation logic reuses (or shares a helper with) the existing e2e bootstrap recipe — temp `HOME`/`AIGON_HOME`, fixture copy, seeded features (`tests/dashboard-e2e/bootstrap.js:104-131`) — rather than duplicating it.
- [ ] The sandbox is on its own isolated port + `<id>.aigon.localhost` (or direct `127.0.0.1:<port>`) and never touches the primary identity.
- [ ] Sandboxes are cleaned up on stop, and a `preview gc`-style path removes orphaned sandbox homes/ports.
- [ ] Documented clearly: default preview = real data, read-only-safe; `--sandbox` = isolated seeded data, safe for write-heavy backend changes.

## Validation
```bash
```

## Technical Approach
`tests/dashboard-e2e/bootstrap.js` already demonstrates the full sandbox recipe:
`fs.mkdtempSync` temp `HOME`/`AIGON_HOME`, copy the brewboard fixture, seed
features via `feature-create`/`feature-prioritise`, then boot a server bound to a
dynamic port with `AIGON_E2E_SERVER`/isolation env. Factor that into a reusable
"ephemeral seeded instance" helper that both the e2e harness and `preview
--sandbox` call. The preview command (from the Scenario A feature) gains a
`--sandbox` branch that, instead of pointing at real data, provisions one of these
seeded homes and points the worktree's server at it.

## Dependencies
- depends_on: worktree-dashboard-preview-launcher
- depends_on: per-machine-dashboard-instance-isolation

## Out of Scope
- Previewing a write-heavy experimental backend against a faithful copy of the
  user's *real live* data (the genuinely hard variant). Deferred deliberately —
  in-progress backend code should not run near a clone of real state, and a
  seeded sandbox covers the practical need.
- Bidirectional sync of sandbox changes back into real state.

## Open Questions
- Seed source: always the brewboard fixture, or allow `--sandbox=<fixture>` to
  pick a seed (empty / brewboard / snapshot-of-current)?
- Lifecycle: keep a sandbox around between runs of the same preview, or always
  fresh per launch?

## Related
- Set: instance-isolation
- Prior features in set: per-machine-dashboard-instance-isolation, worktree-dashboard-preview-launcher
- Scenario B in the discussion that produced this set (write-heavy backend preview).
