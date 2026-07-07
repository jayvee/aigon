---
complexity: high
set: be-arch
depends_on: [629]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:28.556Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-3-finish-setup-migration

## Summary

Finish the stalled setup-command migration and delete `lib/commands/setup-legacy.js`. It is the largest file in the codebase at **5,454 lines**, essentially one giant closure (`createSetupCommands` is defined at line 5,404 — everything above it is its body's helpers), and it has the highest fan-out of any module (79 requires). The migration is already designed and documented — AGENTS.md describes `lib/commands/setup.js` as a "Setup dispatcher plus per-command entry modules" with shared helpers in `lib/commands/setup/` (`seed-reset.js`, `worktree-cleanup.js`, `gitignore-and-hooks.js`, `pid-utils.js`, `agent-trust.js`), and says setup-legacy "preserves the behavior-compatible implementation while individual setup handlers continue to migrate." The continuing has stalled; this feature completes it: every setup-domain command (`init`, `install-agent`, `apply`, `update`, `doctor`, `remove`, `setup`, `global-setup`, checks, notices, seed commands, trust) gets its own entry module, shared logic lands in named helper modules, and the legacy file is deleted.

## User Stories

- [ ] As a maintainer fixing an `install-agent` bug, I open a file that contains install-agent — not a 5,400-line closure where the relevant code is somewhere between lines 800 and 2,300 with helpers shared invisibly across ten commands.
- [ ] As an implementing agent, `aigon doctor --fix` logic is independently readable and testable without loading the entire setup universe.
- [ ] As a reviewer, a change to seed-reset cannot silently affect `aigon remove`, because they no longer share a closure scope — shared behaviour is an explicit import.

## Acceptance Criteria

- [ ] `lib/commands/setup-legacy.js` is **deleted**. `git log` shows the migration as a sequence of per-command extractions, not one big-bang rewrite commit.
- [ ] Each setup command lives in `lib/commands/setup/<command>.js` following the existing entry-module pattern (match the shape of the handlers already migrated — read those first and stay consistent).
- [ ] Closure-shared state is made explicit: helpers used by 2+ commands move to named modules in `lib/commands/setup/` (extend the existing five); helpers used by one command stay in that command's module. No new "shared misc" bucket.
- [ ] Behaviour parity is the hard gate: `install-agent`'s manifest writing (F422), drift layers (F502 — startup warning, version-bump auto-reinstall, lockstep test, prepublish guard), `doctor`/`doctor --fix` repair ordering (migrations first, F353), `remove [--purge]` manifest-driven deletion, and seed-reset semantics are all preserved. The existing integration tests for these (`install-manifest-lockstep.test.js` and friends) pass unmodified.
- [ ] The `createSetupCommands(overrides)` ctx-pattern surface stays identical so `aigon-cli.js` dispatch and tests' override injection don't change.
- [ ] Fan-out drops: no single setup module requires more than ~20 modules (from 79); record before/after in the feature log. New cycles: zero (be-arch-1 guard enforces; remove any setup-legacy baseline entries).
- [ ] Manual smoke in a scratch repo with isolated HOME (per the 2026-06-18 incident rule: override `HOME`/`USERPROFILE` when shell-testing against scratch repos — real `apply`/`doctor` mutate the global registry): `aigon init`, `install-agent cc`, `apply`, `doctor`, `doctor --fix`, `remove --dry-run` all behave as on main. Record transcript in the feature log.
- [ ] AGENTS.md module map: setup-legacy line removed; setup section updated to final shape.

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- Strangler-fig, command by command: extract one command per commit, with setup-legacy shrinking each time; the dispatcher chooses the new module as each lands. This keeps every intermediate commit shippable and bisectable — important because setup touches first-run UX where regressions hit new users (memory: test-as-a-new-user).
- Read the already-migrated entry modules in `lib/commands/setup/` FIRST and copy their conventions (arg parsing, ctx use, output helpers) — this feature should end the "two ways to write a setup command" era, not add a third.
- Watch for order-dependent side effects inside the closure (module-level caches, lazily-initialised registries, `let` state shared across commands) — each is either promoted to an explicit module with a documented lifecycle or localised to its single consumer.
- The install/apply surface is the most user-facing code in Aigon (every beta tester runs it): when in doubt about an edge case's intent, preserve behaviour bit-for-bit and note the oddity in the log rather than "fixing" it silently.
- Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies

- depends_on: be-arch-1-module-graph-guard

## Out of Scope

- Changing any setup/install behaviour, prompts, or output text.
- The onboarding wizard (`lib/onboarding/`) — separate module, untouched.
- Reworking the install manifest schema or drift layers (F422/F502 behaviour is a compatibility constraint here, not a work item).

## Open Questions

- A few setup helpers may be imported by non-setup modules (fan-in into setup-legacy) — inventory first; anything imported from outside the setup domain moves to a proper `lib/` home rather than `lib/commands/setup/`.
- Whether `seed-reset` (per `docs/seeds.md`, has its own footguns) deserves its own smoke in the manual test — recommend yes, against a scratch clone of brewboard-seed.

## Related

- Prior work: the partially-completed setup entry-module migration (read its commits for intent), F422 (install manifest), F502 (template sync guards), F353 (doctor migrations).
- Set: be-arch — largest single file-size reduction in the set (−5,454 lines from one module into ~15 focused ones).
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 631" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-631" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-631)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#629</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 1 module graph gu…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#631</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">be arch 3 finish setup mi…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
