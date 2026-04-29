---
complexity: low
set: prioritise-correctness
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:10:41.114Z", actor: "cli/feature-prioritise" }
---

# Feature: prioritise-dep-validate

## Summary

When `aigon feature-prioritise <slug>` is called on a feature whose `depends_on:` parent (or any feature it transitively depends on) is still in `01-inbox/` and not yet prioritised, the command silently succeeds — assigns the next sequential ID, moves the spec to `02-backlog/` — and produces an invalid state where a high-ID feature depends on a parent that doesn't exist in backlog yet. The dep ordering looks correct from the consumer side (parent ID < child ID will hold once the parent is prioritised) but the absolute IDs end up arbitrary, and there is no signal at all when a dependent ships before its parent.

This feature adds dependency validation to the prioritise path: if any `depends_on:` parent is not already in `02-backlog/`, `03-in-progress/`, `04-in-evaluation/`, or `05-done/`, refuse the prioritise call with a clear error and a suggested fix. Hard fail; loud error; no auto-cascade. The 2026-04-29 incident in this conversation produced exactly this misordering — F443 went to `agent-quota-awareness` when it should have gone to `signal-health-telemetry` because the CLI accepted an arbitrary call order.

First feature in the `prioritise-correctness` set; companion to `prioritise-set-flag`.

## User Stories

- [ ] As an Aigon operator, when I run `aigon feature-prioritise child-feature` while `parent-feature` is still in inbox, I want the command to refuse with a clear error naming the missing parent — not silently assign an ID that I'll have to renumber later.
- [ ] As an Aigon operator, I want the error message to tell me exactly what to do next (`aigon feature-prioritise <parent-slug>` first), so I don't have to read source to figure out the recovery path.
- [ ] As the Aigon developer, I want a single regression test that covers this: prioritising a child before its parent fails non-zero with a stable error string. So a future refactor of the prioritise path can't silently re-introduce the bug.

## Acceptance Criteria

- [ ] `aigon feature-prioritise <slug>` reads the inbox spec's `depends_on:` field (the comma-separated slug list under `## Dependencies`).
- [ ] For each declared parent slug, look up its current location across `01-inbox/`, `02-backlog/`, `03-in-progress/`, `04-in-evaluation/`, `05-done/`. Refuse the prioritise call with exit code non-zero if any parent is in `01-inbox/` or absent from disk.
- [ ] Error message format:
      ```
      ❌ Cannot prioritise <slug> — depends on parent feature(s) not yet prioritised:
         - <parent-slug-1>  (still in 01-inbox/)
         - <parent-slug-2>  (not found on disk)
      Prioritise the parents first:
         aigon feature-prioritise <parent-slug-1>
         aigon feature-prioritise <parent-slug-2>
      Or use --skip-dep-check to override (use sparingly; produces invalid backlog ordering).
      ```
- [ ] `--skip-dep-check` flag exists for the override case (e.g. fixing up a broken state mid-recovery). Logs a warning when used. Not the default path.
- [ ] `depends_on: none` (literal string) and missing-or-empty `depends_on:` are both treated as "no dependencies — prioritise allowed".
- [ ] Soft dependencies (the `Soft dependency:` paragraph format used in `feature-aigon-eval`) are NOT validated. Only the structured `depends_on:` line is gating. Document this clearly in the error message context.
- [ ] Integration test: create two inbox specs where child has `depends_on: parent`; assert that `aigon feature-prioritise child` exits non-zero with the expected error string AND child stays in `01-inbox/`. Then prioritise the parent, retry the child, assert success.
- [ ] Integration test: assert that `--skip-dep-check` succeeds in the same setup with a warning logged.
- [ ] No change to existing prioritise behaviour for features without dependencies. Existing tests pass unchanged.

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/feature-deps.js   # if extracted
npm test -- --testPathPattern='(prioritise|feature-deps)'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.

## Technical Approach

### Where to hook in

`lib/commands/feature.js` already has the `feature-prioritise` handler. Add a dependency check immediately after slug resolution, before the engine state mutation. The check is read-only against disk — no risk of partial state if it fails.

### Parsing `depends_on:`

The current `## Dependencies` block format in specs is freeform — sometimes `depends_on: foo`, sometimes `depends_on: foo, bar`, sometimes `depends_on: none`. A small parser:

```js
function parseDependsOn(specBody) {
  const m = specBody.match(/^depends_on:\s*(.+)$/m);
  if (!m) return [];
  const raw = m[1].trim();
  if (raw === 'none' || raw === '') return [];
  return raw.split(',').map(s => s.trim()).filter(Boolean);
}
```

Lives in a new tiny module `lib/feature-deps.js` (or inline in `lib/commands/feature.js` if that turns out simpler — judge during implementation). The same parser will be reused by `prioritise-set-flag` for topological sort, so factoring it out is the right call.

### Locating parent state

For each parent slug, search the four target folders for a file matching `feature-*-<slug>.md` or (for not-yet-prioritised parents) `feature-<slug>.md` in inbox. Return `{ slug, status: 'inbox' | 'backlog' | 'in-progress' | 'in-evaluation' | 'done' | 'missing' }`.

### Why hard-fail rather than auto-prioritise the parent

Auto-cascade looks helpful but hides intent: the operator may have legitimate reasons to leave a parent in inbox (still drafting, awaiting external info, deprioritised since the dep was written). Refusing with a clear error preserves operator agency. The two-line copy-paste fix in the error message is barely more friction than auto-cascade and stays loud.

### Why the override flag exists

Recovery scenarios exist where the strict check is wrong: cleaning up a half-broken backlog after a failed migration, importing specs from a sibling repo, etc. `--skip-dep-check` documents the escape hatch and logs the deviation. Not the default — operators have to type it.

### Total surface

- New parser: ~15 lines (one regex, one split)
- New validator: ~30 lines (lookup parents across folders, build error message)
- Integration tests: ~80 lines (two scenarios)
- Total: under 150 lines of new code, no engine changes, no template changes.

## Dependencies

depends_on: none

## Out of Scope

- Validating soft dependencies (the freeform paragraph form). They're advisory by definition; gating on them would be wrong.
- Validating `set:` consistency between parent and child (whether dependents must be in the same set as their parent). Out of scope — sets are organisational, not enforced.
- Auto-cascading prioritise (do the parent then the child in one call). Companion feature `prioritise-set-flag` handles bulk prioritisation deliberately; this one stays single-slug and strict.
- Validating that `depends_on:` slugs actually exist as feature specs (typos, renamed parents). Defer — would need a fuzzy-match fallback to be useful, which is its own design problem.

## Open Questions

- What's the right behaviour when a parent is in `06-paused/`? Probably treat as "exists, just paused" — allow prioritise, since the dep relationship is satisfied by the parent existing in the workflow at all. Decide during implementation.
- Should the same check fire on `feature-start <id>`? Probably yes (it's the same bug class — starting a child before its parent is in-progress) but scope-creeps this feature. File as a follow-up.

## Related

- Set: prioritise-correctness
- Companion: feature-prioritise-set-flag (the bulk-prioritise convenience that auto-toposorts; that feature obviates the need for this validator when used, but this validator catches the single-slug path that humans will still take by habit).
- Triggered by: 2026-04-29 conversation incident where I prioritised `agent-quota-awareness` before `signal-health-telemetry` despite recommending telemetry first; the misordering produced inverted IDs that had to be unwound by unprioritise → re-prioritise.
