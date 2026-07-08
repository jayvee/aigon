---
complexity: high
set: be-arch
depends_on: [630]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.730Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-4-worktree-tmux-boundary

## Summary

Complete the F554 session-host boundary and give `lib/worktree.js` a single responsibility. At 2,260 lines it is simultaneously the codebase's second-biggest hub (fan-in 37) and second-biggest importer (fan-out 34), and it currently mixes at least five concerns: (1) git worktree creation/environment setup, (2) agent launch composition (`buildAgentCommand` — ~270 lines building the shell-trap wrapper), (3) raw tmux mechanics (`runTmux`, `tmuxSessionExists`, `createDetachedTmuxSession`, `resolveTmuxTarget`, `isTmuxSessionAttached`, pipe-pane capture) that F554 declared should live only in `TmuxSessionHost` (`lib/agent-sessions/hosts/tmux.js`), (4) terminal app dispatch (`openTerminalAppWithCommand`, `openInWarpSplitPanes`, iTerm handling), and (5) **read-model concerns that don't belong here at all** — `findEntityStage`, `classifyOrphanReason`, `pruneStaleSessionSidecars`, `loadSessionSidecarIndex`, `parseEnrichedTmuxSessionsOutput` are session/dashboard read logic. It also carries a dozen `_getX()` indirection helpers at the top — the classic symptom of a module fighting its own dependency graph. This feature moves each concern to its documented owner and leaves `worktree.js` as worktree lifecycle only.

## User Stories

- [ ] As a maintainer changing how agents launch (new agent, new signal wrapper, new env var), I edit launch-composition modules without touching git-worktree or terminal-app code.
- [ ] As an implementing agent, "the only module doing tmux mechanics is `TmuxSessionHost`" (the F554 contract) is actually true, and the module-graph guard (be-arch-2) keeps it true.
- [ ] As a maintainer, session sidecar enumeration/orphan classification used by the dashboard lives in the `lib/agent-sessions` boundary where F554/F517 said sessions knowledge belongs.

## Acceptance Criteria

- [ ] Tmux mechanics: every direct tmux invocation in `worktree.js` moves behind `TmuxSessionHost` (`lib/agent-sessions/hosts/tmux.js`). `worktree.js` retains, at most, thin deprecated re-exports for external callers (37 importers — keep the facade, mark each re-export `@deprecated` pointing at the new home). Grep proves no `tmux` binary invocation outside `hosts/tmux.js` (encode as a module-graph guard (be-arch-2) boundary rule or a targeted test).
- [ ] Launch composition: `buildAgentCommand`, `buildResearchAgentCommand`, `buildAgentWrapperEnvironmentLines`, heartbeat/signal wrapper assembly, and inline-prompt-file writing move to a dedicated module (e.g. `lib/agent-launch-command.js` beside the existing `lib/agent-launch.js` triplet resolver, or an `lib/agent-launch/` folder if the two merge naturally). The launch env-var contract (`AIGON_ENTITY_TYPE`, `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`, `AIGON_PROJECT_PATH`) and shell-trap signal behaviour are byte-compatible — the generated shell command for a representative wt is captured before/after and diffed in the feature log.
- [ ] Terminal app dispatch (`openTerminalAppWithCommand`, `openInWarpSplitPanes`, `openSingleWorktree` terminal parts): moves next to `lib/terminal-adapters.js` ownership (that module is already the adapter registry per F350).
- [ ] Session read-model helpers (`findEntityStage`, `classifyOrphanReason`, `pruneStaleSessionSidecars`, `loadSessionSidecarIndex`, `parseEnrichedTmuxSessionRow/Output`, `getEnrichedSessions`): move into `lib/agent-sessions/` (store/service side), respecting its import rules (domain files import no worktree/dashboard/commands). Dashboard and `session-list` consume them from there.
- [ ] `lib/worktree.js` ends the feature owning only: worktree base paths, `git worktree add/remove` orchestration, `setupWorktreeEnvironment` (incl. `worktreeSetup` execution, F524), permissions/trust presetting, and attribution install. Target ≤ ~900 lines; record before/after.
- [ ] The `_getX()` lazy-indirection helpers at the top of worktree.js are eliminated where the underlying cycle is gone (coordinate with be-arch-2), or documented individually where they must remain.
- [ ] All existing worktree/session/launch tests pass; add the tmux-name parse and launch-command round-trip regressions to whichever module now owns them (moves, not rewrites — respect the T3 test budget).
- [ ] Baseline shrink: worktree-related cycles/violations removed from the module-graph baseline (be-arch-2). AGENTS.md module map rows for `worktree.js`, `agent-sessions/`, `terminal-adapters.js`, `agent-launch` updated.

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Sequence: (1) read-model helpers out (lowest risk, pure moves), (2) terminal dispatch out, (3) launch composition out, (4) tmux mechanics behind the host — each its own commit with the facade re-exports keeping all 37 importers compiling untouched.
- F554 already did the hard design: `createDetachedTmuxSession` is documented as "a thin wrapper over `TmuxSessionHost.startSession` (capture wiring stays here via `attachSessionCapture`)". This feature moves the capture wiring too — the host grows a capture option rather than worktree reaching around it.
- **Validate end-to-end with real tools** (memory: validate-with-real-tools-first): after the launch-composition move, run a real `aigon feature-start` on a scratch feature in a test repo and watch the tmux session come up, signals fire, and heartbeat tick — "unit tests pass" is not sufficient for launcher changes. Record the transcript in the log.
- Never kill or reuse existing live agent sessions while testing (memory: never-kill-agent-sessions); use scratch entities only.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies

- depends_on: be-arch-2-config-registry-decycle (module-graph guard + config decycle — merged from be-arch-1)

## Out of Scope

- Changing session naming, sidecar schema, tmux flags, or any launch semantics.
- Migrating the 37 importers off the worktree facade (follow-up mechanical work).
- New session host types (the hosts registry exists; this feature only completes tmux's containment).
- `gracefullyCloseEntitySessions` / `ensureAgentSessions` behaviour changes — they move (to agent-sessions service) but do not change.

## Open Questions

- Whether `lib/agent-launch.js` (triplet resolver, ~130 lines) and the extracted launch-command builder should be one module or two — decide by whether they share consumers; do not force a merge.
- `attachSessionCapture` transcript-rotation script (`_ensureTmuxRotateScript`) — belongs with the host's capture feature; confirm no other caller depends on the script path directly.

## Related

- Prior work: F554 (agent-sessions boundary + TmuxSessionHost — this feature finishes it), F350 (terminal adapter registry), F414 (registry dispatch), F351 (tmuxId routing).
- Set: be-arch — pairs with be-arch-5: both push read-model knowledge out of action-side modules and into the documented read-side owners.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 632" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-632" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-632)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#630</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 2 config registry…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#632</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 4 worktree tmux b…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
