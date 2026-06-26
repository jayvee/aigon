---
complexity: medium
set: instance-isolation
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-26T00:57:20.249Z", actor: "cli/feature-prioritise" }
---

# Feature: worktree dashboard preview launcher

## Summary
Today there is no clean way to see a feature's in-progress changes running until
it is merged. If feature 50 is being built in a worktree and changes the
dashboard UI, you can't view it: running the global `aigon` runs the *main*
checkout's code, and running the worktree's own `aigon-cli.js` against the shared
`~/.aigon` / port 4100 / `aigon.localhost` collides with and kills your dev
dashboard. This feature adds `aigon preview <feature-id>` — a one-command launcher
that boots the **worktree's own** dashboard server in the existing preview mode,
on an isolated port and `<id>.aigon.localhost` subdomain, coexisting with your
primary dev dashboard. It fully solves the UI-change case (Scenario A) and, for
free, also runs the worktree's modified backend code for read-only backend
changes. The feature also closes the loop in the agent operating instructions so
aigon-on-aigon agents are told to verify worktree UI changes against the preview
URL (CLAUDE.md / AGENTS.md), not the primary dashboard.

## User Stories
- [ ] As a developer, I can run `aigon preview 50` and open a dashboard that shows feature 50's UI changes, without merging and without disturbing my primary dashboard.
- [ ] As a developer reviewing a worktree, the preview runs that worktree's actual code (UI and lib), so what I see is what the branch produces.
- [ ] As a developer, I can run the preview alongside my primary dashboard and other previews at the same time, each on its own URL.

## Acceptance Criteria
- [ ] `aigon preview <feature-id>` resolves the feature's worktree path, then launches that worktree's `aigon-cli.js` dashboard server in preview mode (`options.templateRoot` → the worktree root, `lib/dashboard-server.js:449-450`, `157-165`, `1134`) so the UI is served from the worktree's `templates/dashboard/`.
- [ ] The preview binds an isolated, deterministic port (via the instance-identity model from the foundation feature; reuse `hashBranchToPort`) and registers a `<id>.aigon.localhost` Caddy route — never `aigon.localhost` / the primary port.
- [ ] Launching, re-launching, and stopping a preview never touches the primary dashboard's PID, port, or `aigon.localhost` route.
- [ ] The command prints the preview URL and supports stopping it (`aigon preview <id> --stop` or equivalent), with dead previews garbage-collected like other worktree dev servers.
- [ ] Read-only backend changes in the worktree (e.g. status collectors, analytics, a new read-only API endpoint) are exercised correctly because the preview runs the worktree's own `lib/*.js`.
- [ ] By default the preview reads the same project/`~/.aigon` data so a pure UI change renders against realistic content (write-heavy isolation is the separate sandbox feature).
- [ ] **Agent operating instructions are updated** so aigon-on-aigon agents actually use this. CLAUDE.md rule 4 (browser-MCP verification) and the AGENTS.md browser-MCP section state that when verifying a dashboard UI change **from a worktree**, the agent must run `aigon preview <id>` and snapshot/screenshot **that preview URL** — never the primary `aigon.localhost` (which serves main's HTML, not the worktree's edits) and never by starting a server that collides with the primary.
- [ ] The verification discipline distinguishes the two isolated-instance uses so agents pick correctly: **automated regression** = the e2e bootstrap (`tests/dashboard-e2e/bootstrap.js`); **interactive UI verification** = `aigon preview <id>`. This guidance lives in CLAUDE.md / AGENTS.md (not memory), because worktree agents cannot read the operator's memory.
- [ ] CONTRIBUTING.md (Browser MCP / test-stages section) notes where `aigon preview` sits relative to `test:browser` / `test:browser:smoke`.

## Validation
```bash
```

## Technical Approach
Preview mode already exists: passing `options.templateRoot` makes the server
serve `<templateRoot>/templates/dashboard/` and sets `isPreview` true
(`dashboard-server.js:449-450`). The worktree dev-server port-hash + subdomain
machinery also exists (`server-runtime.js:82-83`, `proxy.js:325-327`). This
feature is mostly wiring: a thin `preview` command that locates the worktree
(`feature-status.js:43` style worktree resolution under
`~/.aigon/worktrees/<repo>/<branch>`), shells out to the worktree's
`aigon-cli.js server start` with the preview/instance env set, waits for the
port, and reports the URL. It depends on the foundation feature so that "isolated
identity" is structural rather than hand-set per invocation.

## Dependencies
- depends_on: per-machine-dashboard-instance-isolation

## Out of Scope
- Isolating write-heavy backend changes from real state (separate feature:
  sandboxed-preview-for-backend-changes).
- Any change to how features are built/merged — preview is read-only observation.
- Hot-reload of the worktree dashboard on file change (manual re-run is fine).

## Open Questions
- Command surface: dedicated `aigon preview <id>` vs. a flag on `feature-open`?
  (Leaning dedicated command for discoverability.)
- Should preview auto-rebuild/restart when the worktree's templates change, or
  stay a manual one-shot?

## Related
- Set: instance-isolation
- Prior features in set: per-machine-dashboard-instance-isolation
- Scenario A in the discussion that produced this set (UI-change preview).
