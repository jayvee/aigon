---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T13:59:52.699Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-status-collector-skip-done-reads

## Summary

The dashboard status poll takes 5-7 seconds at this user's scale (7 repos, 665 features, 39 research). Confirmed via `/Users/jviner/.aigon/dashboard.log` showing `Poll complete (7 repos, 665F/39R, 6021ms)` consistently. While the loop is busy, every `/api/spec` request queues — that's the multi-second "Loading…" hang in the spec drawer.

Root cause: `collectDoneSpecs` (`lib/dashboard-status-collector.js:147`) iterates `.aigon/workflows/{features,research}/<id>/`, reads every `snapshot.json`, then walks every `events.jsonl` line-by-line to find the close-event timestamp — for hundreds of immutable, already-done features, every poll. F454 fixed F446's quota scan and the dep-graph rebuild; this is the dominant cost it didn't touch.

Fix: **don't read done content.** Done features are immutable. Their `(id, name)` come from the filename. The kanban only needs that plus an mtime-based "recent" ordering. Filename-only enumeration eliminates the 600+ snapshot reads + events walks per poll cycle.

## User Stories

- [ ] As John, when I click a spec card in the drawer, the spec content fills within 200 ms — no multi-second "Loading…".
- [ ] As John, the dashboard `Poll complete` log line stays under 200 ms p95 with 665F/39R.

## Acceptance Criteria

- [ ] `Poll complete (… Xms)` log line stays under 200 ms p95 with the user's existing 7-repo 665F/39R workspace.
- [ ] `/api/spec` p95 under 100 ms while the dashboard is otherwise idle (no manual action firing).
- [ ] `collectDoneSpecs` no longer reads `snapshot.json` or `events.jsonl` for done features. File enumeration only.
- [ ] Recent-done ordering uses spec file mtime (not engine close-event timestamp).
- [ ] All existing tests green. `tests/integration/engine-first-folder-fallback.test.js` is the most likely regression candidate — verify F397 engine-first behaviour is preserved for `isEntityDone()` callers (engine-state-bearing logic) even though the dashboard-display path no longer uses engine snapshots for done enumeration.

## Validation

```bash
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

Single function rewrite. ~30-50 LOC delta. No caching infrastructure, no invalidation logic, no migration.

### `lib/dashboard-status-collector.js`

1. **`collectDoneSpecs(doneDir, pattern, limit, options)` — filename-only enumeration.** Replace the body (lines 147 onward) with:
   - `fs.readdirSync(doneDir).filter(f => pattern.test(f))` — single directory listing, no per-file reads.
   - For each filename: parse `(id, name)` from the regex match groups already in `pattern`.
   - Sort by spec file mtime (single `fs.statSync` per file, fast — but skip even that if `limit` is the only consumer; instead sort by descending feature ID number for stable, monotonic ordering since IDs are assigned in chronological prioritise order).
   - Take top `limit` for the `recent` array.
   - Return `{ recent: [...], total: filteredFilenames.length }`.

2. **Drop the engine-first enumeration block** (lines 161-208 currently). Reasoning: it exists to handle features the engine has marked done before the spec file has been moved to `05-done`. For dashboard *display*, this transient state lasts ~1 poll cycle; the feature briefly shows in 03-in-progress instead of done, then snaps to done on the next cycle. That's an acceptable display lag in exchange for sub-200ms polls.

3. **Preserve engine-first for non-display callers.** F397's `isEntityDone()` helper in `lib/workflow-core/entity-lifecycle.js` is the authoritative engine-state read; nothing here changes. Only the dashboard-display done-enumeration path is being trimmed. Verify by grep: any caller that needs "is this feature done according to the engine" must still go through `isEntityDone()`, NOT through `collectDoneSpecs.recent`.

### Restart rule

After this `lib/*.js` edit, run `aigon server restart` (CLAUDE.md hot rule).

### Verification path

- `npm run test:iterate` (covers `engine-first-folder-fallback.test.js`).
- Pre-push: `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`.
- Manual confirmation: `tail -f /Users/jviner/.aigon/dashboard.log` and watch `Poll complete (...)` lines drop from ~6000 ms to <200 ms within one poll cycle of restart. Click 10 spec drawers in rapid succession — `GET /api/spec` should always be <50 ms with no observable "Loading…" pause.

## Dependencies

-

<!-- Independent of F454/F455. F454 already fixed the F446 quota scan and dep-graph
     rebuild, but missed the dominant cost in collectDoneSpecs. -->

## Out of Scope

- Migrating engine state to SQLite — explicitly deferred. The right long-term move for state persistence and aggregations, but a separate spec belongs to that. This feature is the surgical filename-only fix only.
- Any caching layer or mtime-based invalidation. Done content isn't read at all, so there's nothing to cache.
- Changes to active-set collection (in-progress / in-evaluation / paused / backlog / inbox). The active set is small (~30 features) and changes constantly; full reads each poll are correct.
- Changes to research done enumeration. Apply the same fix there — `collectDoneSpecs` is shared between feature and research paths via the `entityType` option, so the rewrite covers both.
- F397's engine-first `isEntityDone()` helper — stays as-is. Only the *display* path is trimmed.

## Open Questions

- Should the `recent` sort use feature ID descending (chronological prioritise order) or spec mtime descending (chronological close order)? Lean ID descending — no `statSync` calls at all, and IDs are monotonic. Mtime would technically be more accurate for "recently completed" semantics but the visual difference is negligible and the perf win is real.
- Should we keep the `total` count? Yes — the kanban shows "5 done" badges. `filteredFilenames.length` is free.

## Related

- Research: <!-- N/A -->
- Set: <!-- standalone -->
- Prior features in set: <!-- F454 (event-loop unblock — incomplete diagnosis), F397 (engine-first lifecycle precedence — preserved by this feature) -->
