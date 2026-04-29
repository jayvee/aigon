---
complexity: medium
set: prioritise-correctness
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:10:41.377Z", actor: "cli/feature-prioritise" }
---

# Feature: prioritise-set-flag

## Summary

Today, `aigon feature-prioritise` is a single-slug command. To prioritise a feature set in dependency order — multiple specs sharing a `set:` tag with `depends_on:` relationships — the operator must manually call the command in the correct topological sequence. Get the order wrong and the IDs end up arbitrary; the dep-graph still validates (parent ID < child ID *eventually*) but the linear backlog ordering no longer reflects the recommended run order. The 2026-04-29 incident in this conversation demonstrated the failure: I prioritised `agent-quota-awareness` first when `signal-health-telemetry` was the higher-leverage foundation, producing an ordering inversion that had to be manually unwound.

This feature adds `aigon feature-prioritise --set <slug>` (and `--all-sets` for the bulk case): read every inbox feature with `set: <slug>` in frontmatter, topologically sort by `depends_on`, then call the existing prioritise path in that order. Tie-breaker for parallel-buildable foundations: `set_lead: true` frontmatter, then alphabetical. One command, deterministic outcome, no human ordering bug.

Companion to `prioritise-dep-validate` in the `prioritise-correctness` set; together they close both halves of the misordering risk (single-slug strict + bulk auto-toposort).

## User Stories

- [ ] As an Aigon operator who has just authored four feature specs sharing `set: signal-health`, I want to run `aigon feature-prioritise --set signal-health` once and get all four prioritised in topological order — not call prioritise four times remembering the dep order myself.
- [ ] As an Aigon operator with two foundations in the same set that both have no deps, I want a deterministic tie-breaker so the same set always prioritises in the same order — `set_lead: true` on the chosen foundation, falling back to alphabetical.
- [ ] As an Aigon operator, I want to see the planned prioritise order printed before any move happens, with a y/n confirmation prompt so I can abort if the topo sort produces an order I didn't expect.
- [ ] As an Aigon operator running an autonomous batch script, I want a `--yes` flag to skip the confirmation prompt for unattended runs.

## Acceptance Criteria

- [ ] `aigon feature-prioritise --set <set-slug>` reads every spec in `01-inbox/` whose frontmatter has `set: <set-slug>`.
- [ ] If the inbox has zero matching specs: exit non-zero with an error naming the set and listing currently-known sets (computed from frontmatter across the inbox + backlog).
- [ ] Build a dependency graph from each matching spec's `depends_on:` line. Detect cycles; on cycle, exit non-zero with the cycle path printed.
- [ ] Toposort the graph. Tie-breaker rules:
      1. **Foundations with `set_lead: true`** in frontmatter rank first (allows the operator to declare the highest-leverage foundation explicitly).
      2. Otherwise, alphabetical by slug (deterministic, no surprises).
- [ ] Print the planned prioritise sequence with a confirmation prompt:
      ```
      Set 'signal-health' — 3 specs to prioritise in this order:
        1. signal-health-telemetry        (foundation, set_lead)
        2. auto-nudge-with-visible-idle   (deps: signal-health-telemetry)
        3. aigon-eval                     (deps: signal-health-telemetry, auto-nudge-with-visible-idle)
      Proceed? [y/N]
      ```
- [ ] On `y`, iterate the sorted list and call the existing `feature-prioritise <slug>` path for each. On any single-step failure (e.g. dep-validate refuses), STOP — do not continue with later items, do not roll back already-prioritised items. Print which step failed and how to recover.
- [ ] `--yes` flag skips the confirmation prompt for unattended use.
- [ ] `--dry-run` flag prints the plan and exits without prioritising. Useful for verifying the toposort before committing.
- [ ] `--all-sets` flag iterates every distinct `set:` value in the inbox; prompts (or with `--yes` skips) once per set, in alphabetical set-slug order. Useful for "I just authored five sets worth of features overnight, prioritise them all."
- [ ] Cross-set `depends_on:` references (e.g. `aigon-eval` depending on `agent-quota-awareness` from a different set, when both share frontmatter) are honoured if both are present in the same `--set` invocation; if the cross-set parent is not in the current invocation's scope and not already in backlog, treat as `prioritise-dep-validate` would (refuse, with a clear message that the parent must be prioritised first or `--set` invoked together).
- [ ] Integration test: three inbox specs in one set with a clear dep chain; assert `--set` prioritises them in the right order with stable IDs assigned in sequence.
- [ ] Integration test: a cyclic dep is detected and reported, no specs move.
- [ ] Integration test: `--all-sets` against two distinct sets prioritises each in toposort order.
- [ ] Behaviour without `--set` is identical to today's command. Existing tests pass unchanged.

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/feature-deps.js
npm test -- --testPathPattern='(prioritise|set-flag|feature-deps)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.

## Technical Approach

### Reuses the dep parser from `prioritise-dep-validate`

Both features need the same `parseDependsOn(specBody)` function. Implement it once in `lib/feature-deps.js` (created by whichever of the two ships first; the other imports). Same module also gets a `topoSort(specs)` helper for this feature's needs:

```js
// lib/feature-deps.js
function parseDependsOn(specBody) { ... }       // shared with prioritise-dep-validate
function readSetMembership(specPath) { ... }     // reads frontmatter set: + set_lead:
function topoSort(specs) { ... }                 // Kahn's algorithm with tie-breaker
function detectCycles(specs) { ... }             // reports cycle path on detection
```

### The flow

```
1. Scan 01-inbox/ for specs with frontmatter set: <slug>
2. Parse depends_on: from each
3. Build directed graph (edges parent → child)
4. Detect cycles → fail loud
5. Topo sort with tie-breaker (set_lead, then alpha)
6. Print plan, prompt y/n (unless --yes)
7. Iterate, calling existing feature-prioritise handler for each slug
8. Stop on first failure; do not roll back
```

### Why "stop on first failure, no rollback"

Two reasons. First, rollback is fragile — `feature-prioritise` already auto-commits each move, so rollback would mean a follow-up commit reversing the move, which clutters git history and could conflict with concurrent work. Second, a partial set is still useful: half the foundations prioritised, the rest still in inbox, is a recoverable state the operator can finish manually. A failed mid-run with rollback would just look like nothing happened, hiding the failure cause.

### Tie-breaker design

`set_lead: true` is intentionally minimal — one boolean per set. The set may have at most one lead; if multiple specs claim `set_lead: true`, fail loud with both filenames. If zero specs claim it, fall back to alphabetical (so behaviour is deterministic even when the operator hasn't declared a lead).

This design avoids inventing a richer ordering language (priority numbers, weights, "ship before X" hints) because the dep graph already encodes the load-bearing ordering. `set_lead` is purely a tie-breaker for the genuinely-parallel-buildable case.

### Total surface

- `lib/feature-deps.js`: ~80 lines (parser + reader + topo + cycle detector)
- `lib/commands/feature.js`: ~50 lines for `--set`, `--all-sets`, `--dry-run`, `--yes` flag handling and the loop
- Integration tests: ~150 lines (three scenarios + cycle test + cross-set parent case)
- Template change: a one-line note added to `## Related → Set:` documentation pointing operators at `--set` for bulk prioritisation
- Total: under 300 lines of new code, no engine changes.

## Dependencies

depends_on: none

(Both `prioritise-correctness` features are independent and parallel-buildable. The `lib/feature-deps.js` module that `prioritise-dep-validate` introduces is reused by this feature; whichever ships first creates the module, the other imports it. No strict ordering required at the spec level.)

## Out of Scope

- Auto-prioritising paused features (`06-paused/`). They sit outside the inbox-to-backlog flow this command exercises.
- Cross-set toposort across the entire inbox without explicit `--all-sets`. Matter of principle: bulk operations require explicit operator opt-in.
- A "prioritise everything in inbox regardless of set" mode. Sets exist for organisation; this feature's whole point is to prioritise within set boundaries.
- Reordering already-prioritised features in `02-backlog/` (renumbering via unprioritise + re-prioritise). The 2026-04-29 incident showed this is occasionally necessary, but it's a separate concern — file as a follow-up if recurring.
- Soft-dep handling beyond the structured `depends_on:` line. Soft deps are advisory; topo sort ignores them by design.

## Open Questions

- Should `set_lead: true` constrain to *only one foundation* per set, or allow multiple (with all leads sorted alphabetically among themselves before non-lead foundations)? Initial decision: exactly one. Multiple leads suggests the set is poorly factored; force a re-think rather than papering over it.
- The confirmation prompt's "Proceed?" UX on a non-TTY (CI / scripted) — does it default-N (safe) or default-Y (gets-stuff-done)? Initial decision: default-N, require `--yes` for non-interactive use. Mirrors GNU coreutils convention.
- Should the planned-order printout include the cross-set soft-dep edges (rendered differently)? Probably yes — the operator might choose to invoke a *different* set first if a soft-dep-needed foundation is missing. Decide during implementation.

## Related

- Set: prioritise-correctness
- Companion: feature-prioritise-dep-validate (single-slug strict mode; this feature is the bulk-with-toposort mode; together they cover both call patterns).
- Triggered by: same 2026-04-29 incident as the validator. The validator catches the single-slug path; this feature obviates the need for the validator when used (toposort never produces invalid order). Both ship because operators will continue to use single-slug `feature-prioritise <slug>` by habit.
