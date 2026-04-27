---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T12:19:24.990Z", actor: "cli/feature-prioritise" }
---

# Feature: align-dashboard-labels-with-f404-agent-statuses

## Summary

F404 renamed the canonical agent-status completion signals (`submitted` → `implementation-complete` / `revision-complete` / `research-complete`; `feedback-addressed` → `revision-complete`) and added new active-session signals (`revising`, `spec-reviewing`). The CLI accepts the new vocabulary, but the dashboard, public docs, and several reference command pages still speak the old language. The summary pill row, the notification labels, the agent submission-row label, and the `agent-status` reference table all advertise "Submitted" — which means the **N submitted** counter never increments under the new signals (server aggregates only `implementing | waiting | submitted | error`), the filter chip matches nothing, and users reading docs still see deprecated values as canonical.

This feature aligns the dashboard rendering, summary aggregation, notification labels, and public docs with the F404 vocabulary in one bundled change so wire / UI / docs stay coherent.

## User Stories

- [ ] As a fleet operator watching the monitor view, I see an accurate count of agents that have completed their session — the **N complete** pill counts every `*-complete` signal, not just the deprecated `submitted` alias.
- [ ] As a solo developer, the agent card label reads "Implementation complete" / "Revision complete" / "Research complete" / "Review complete" / "Spec review complete" — never "Submitted" — once an agent has signalled completion.
- [ ] As an agent author reading `docs/reference/commands/infra/agent-status`, I see all current canonical signals listed with meanings, plus a clearly-marked "Deprecated aliases" sub-section that documents the remap rule.
- [ ] As a user reading the `feature-do`, `feature-code-revise`, `security-scanning`, and `security-scan` reference pages, the example invocations show the canonical completion signals, not `submitted`.

## Acceptance Criteria

### Dashboard summary + filter pills

- [ ] `templates/dashboard/index.html:67-70` and `templates/dashboard/js/monitor.js:148-159` no longer key the summary on `submitted`. The bucket is renamed `complete` and aggregates the union of completion signals: `implementation-complete`, `revision-complete`, `research-complete`, `review-complete`, `spec-review-complete`. The pill text reads **"N complete"**.
- [ ] The `implementing`, `waiting`, and `error` buckets continue to count exactly the agent-status values of the same name (no behavioural change there).
- [ ] Filter chip click on **complete** filters items where any agent's status is in the completion-signal set above.
- [ ] Server-side summary, if it pre-computes the `summary` object (search `lib/dashboard*.js`, `lib/workflow-read-model.js`, `lib/dashboard-status-collector.js`), is updated in lockstep: emit `complete` instead of `submitted`. If the server only ever emits per-agent statuses and the client aggregates, no server change is needed — verify by tracing.
- [ ] `localStorage` filter key handling: existing users with `aigon_filter=submitted` persisted are silently migrated to `complete` on read (one-line shim in the filter store init, e.g. `if (stored === 'submitted') stored = 'complete'`).

### `AGENT_STATUS_META` (`templates/dashboard/js/pipeline.js:332-347`)

- [ ] Remove the `submitted` row entirely. The CLI deprecation path (`lib/commands/misc.js:223-238`) already remaps the alias before any state is written, so no `submitted` value reaches the dashboard.
- [ ] Remove the `feedback-addressed` row entirely. Same reasoning — the CLI rejects/remaps it.
- [ ] Remove the orphan `addressing-review` row — it is not in the valid-status list anywhere in `lib/`, so it is dead code.
- [ ] Change `implementing` from `{ icon: '○', label: 'Session ended', cls: 'status-ended' }` to `{ icon: '●', label: 'Implementing', cls: 'status-running' }`. The compound-override path (lines 357-368) already handles the "tmux not running" / `sessionEnded` cases and must continue to do so. Verify the override still fires for solo-drive and fleet-with-ended-session.
- [ ] Update the compound-override block at `pipeline.js:357-368` so its exclusion list refers only to current valid statuses (drop the `submitted` and `feedback-addressed` checks; they are now unreachable).

### Notifications (`templates/dashboard/js/init.js:602-608`)

- [ ] `agent-submitted` label changes from "Submitted" to **"Complete"**.
- [ ] `all-submitted` label changes from "All Submitted" to **"All complete"**.
- [ ] `all-research-submitted` stays **"Research done"** (already correct, just confirm).
- [ ] The notification *event type* keys (`agent-submitted`, `all-submitted`) remain unchanged on the wire — the server emits them in `lib/dashboard-server.js:1438,1688-1721` and renaming the wire format is out of scope. Only display labels change.

### Detail-tabs panel (`templates/dashboard/js/detail-tabs.js`)

- [ ] `detail-tabs.js:140` — replace `af.status === 'submitted'` with a check that matches the completion-signal set (extract a small helper `isCompleteStatus(s)` that the summary path reuses). Use the agent's `submittedAt`/equivalent timestamp if still present; otherwise use `updatedAt` from the agent-status record at the moment the completion was signalled.
- [ ] `detail-tabs.js:246` — change the row label from `'Submitted'` to `'Completed'` (the timestamp framing). The corresponding `stats.submittedAt` field name is internal — leave it named `submittedAt` (renaming the field is a separate, larger change; out of scope here).

### Public docs

- [ ] `site/content/reference/commands/infra/agent-status.mdx` — rewrite the "Valid statuses" table to include all current canonical statuses:
  - Active: `implementing`, `reviewing`, `revising`, `spec-reviewing`
  - Completion: `implementation-complete`, `revision-complete`, `review-complete`, `spec-review-complete`, `research-complete`
  - Other: `waiting`, `error`, `awaiting-input`
- [ ] Add a "Deprecated aliases" sub-section to the same page documenting:
  - `submitted` — remapped to `implementation-complete` by default, or `revision-complete` if the recorded session `taskType` is `revise`, or `research-complete` if entityType is `research`. Logic in `lib/commands/misc.js:421-431`.
  - `feedback-addressed` — no-op alias; agents must call `revision-complete` to advance state. Logic in `lib/commands/misc.js:233-238`.
- [ ] Update example invocations on the `agent-status.mdx` page (`Usage` block, lines 33-44) to use `implementation-complete` for the primary example.
- [ ] `site/content/reference/commands/feature/feature-do.mdx` — update the `--auto-submit` description (line 23) and step 5 (line 39) from `agent-status submitted` to `agent-status implementation-complete`.
- [ ] `site/content/reference/commands/feature/feature-code-revise.mdx:36` — change "Signals `code_revision_complete` to the engine via `aigon agent-status submitted`" to "via `aigon agent-status revision-complete`".
- [ ] `site/content/guides/security-scanning.mdx:10` — update the trigger list to reference `agent-status implementation-complete` (and note `revision-complete` also runs the gate).
- [ ] `site/content/reference/commands/infra/security-scan.mdx:31` — same update: rename `agent-status submitted` to the canonical signals.
- [ ] `site/public/llms.txt` — grep for `agent-status submitted` and `feedback-addressed` references; update to canonical signals if present.

### Verification (must pass before submitting)

- [ ] `npm test` passes.
- [ ] `MOCK_DELAY=fast npm run test:ui` passes (this feature touches `templates/dashboard/**`, so Playwright is required at submit; iterate-loop may still skip it per Pre-authorised).
- [ ] `bash scripts/check-test-budget.sh` passes.
- [ ] Manual smoke: with `aigon dev-server start`, drive a feature through `agent-status implementation-complete` and confirm the **N complete** pill increments and the agent card reads "Implementation complete".
- [ ] Manual smoke: drive a revise pass via `agent-status revision-complete`, confirm "Revision complete" label appears.
- [ ] `grep -rn "Submitted\|submitted" templates/dashboard/` returns only references that are intentional (CSS class names like `.status-submitted` may stay — they're internal style hooks; only user-visible label strings must be gone).

## Validation

```bash
node --check aigon-cli.js
node --check templates/dashboard/js/pipeline.js
node --check templates/dashboard/js/monitor.js
node --check templates/dashboard/js/init.js
node --check templates/dashboard/js/detail-tabs.js
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May rename CSS classes only if strictly necessary; otherwise keep `.status-submitted` as an internal style token (do not propagate the rename through CSS).

## Technical Approach

### Why one bundled feature

The four surfaces (summary pills, per-agent label table, notifications, public docs) all encode the same vocabulary. Splitting them into separate features would create a window where the dashboard counter says 0 while agents are visibly complete, or where docs contradict the CLI. F404 already shipped the wire change; this feature is the rendering / docs catch-up. Bundle keeps wire + UI + docs aligned in one merge.

### Source-of-truth approach

Introduce a single shared helper module exported from `templates/dashboard/js/pipeline.js` (or a sibling `agent-status-meta.js` if pipeline.js is already large):

```js
const COMPLETION_STATUSES = new Set([
  'implementation-complete',
  'revision-complete',
  'research-complete',
  'review-complete',
  'spec-review-complete',
]);
function isCompleteStatus(s) { return COMPLETION_STATUSES.has(s); }
```

Use this set in three places:
1. `monitor.js` `computedSummary` — bump `summary.complete` for any status in the set.
2. `monitor.js` `getFeatures` / `getResearch` filter — match `complete` against the set.
3. `detail-tabs.js:140` — replace the `=== 'submitted'` check.

This avoids duplicating the list and makes the next vocabulary change a one-line edit.

### Read-model / server side

Trace whether `lib/workflow-read-model.js` or `lib/dashboard-status-collector.js` pre-computes the `summary` object that `monitor.js:150` falls back to. The fallback `{ implementing: 0, waiting: 0, submitted: 0, error: 0 }` suggests there is a server-side aggregator. If the server emits a `summary` field, update it to emit `complete` (and keep `submitted` as a deprecated alias for one release if any external integrations read the dashboard JSON — but check git log first; if no one else consumes that shape, just rename cleanly).

`lib/state-queries.js:96` (`agentImplementingOrSubmittedWithTmux`) currently treats `submitted` as a possible status. After F404 the CLI never writes `submitted`, but the engine's hydrate-rule path still references `'submitted'` (`lib/feature-workflow-rules.js:524,537,540-542`, `lib/research-workflow-rules.js:19`). **These are engine-internal lifecycle states, not agent-status values** — leave them alone. This feature is rendering + docs only; engine state names are out of scope.

### What stays untouched

- `lib/state-render-meta.js` — server-side `currentSpecState` rendering. The state names there (`submitted`, `implementing`, etc.) are *workflow lifecycle states*, not agent-status values. Different namespace; leave as-is.
- `lib/feature-workflow-rules.js` and `lib/research-workflow-rules.js` engine state names.
- The wire format of notification events (`agent-submitted`, `all-submitted` event types stay; only display labels change).
- The `submittedAt` field name on agent-status records and the `signal.agent_submitted` event type — internal names, renaming is a larger refactor that doesn't belong in a label-alignment feature.
- CSS class names (`.status-submitted`, `.kcard-agent-status.status-submitted`) — internal style hooks, leave as-is.

### Files in scope

| File | Change |
|------|--------|
| `templates/dashboard/js/pipeline.js` | Remove deprecated rows from `AGENT_STATUS_META`; fix `implementing` label; export `isCompleteStatus` helper; update compound-override exclusion list |
| `templates/dashboard/js/monitor.js` | Rename summary bucket `submitted` → `complete`; aggregate completion-signal set; filter logic update |
| `templates/dashboard/index.html` | Rename pill `'submitted'` → `'complete'`; update `x-text` to "N complete" |
| `templates/dashboard/js/init.js` | Update `NOTIF_TYPE_LABELS_DISPLAY` labels |
| `templates/dashboard/js/detail-tabs.js` | Replace `=== 'submitted'` check; rename row label "Submitted" → "Completed" |
| `lib/workflow-read-model.js` *or* `lib/dashboard-status-collector.js` | If they emit `summary.submitted`, rename to `summary.complete` (verify by trace) |
| `site/content/reference/commands/infra/agent-status.mdx` | Rewrite valid-statuses table; add deprecated-aliases section; update examples |
| `site/content/reference/commands/feature/feature-do.mdx` | Update `--auto-submit` description and step 5 |
| `site/content/reference/commands/feature/feature-code-revise.mdx` | Update step 4 signal name |
| `site/content/guides/security-scanning.mdx` | Update trigger list |
| `site/content/reference/commands/infra/security-scan.mdx` | Update gate-trigger description |
| `site/public/llms.txt` | Grep + update if relevant |

### Implementation order

1. Trace server-side `summary` computation. Confirm whether the server emits `summary.submitted` or whether `monitor.js` builds it client-side.
2. Land the helper (`isCompleteStatus` + `COMPLETION_STATUSES`) and use it in `monitor.js` and `detail-tabs.js`.
3. Update `pipeline.js` `AGENT_STATUS_META` and compound-override block.
4. Update `index.html` pill markup.
5. Update `init.js` notification labels.
6. Run `npm test` + `MOCK_DELAY=fast npm run test:ui`. Capture a Playwright screenshot of the monitor pill row before/after.
7. Update public docs (one PR-sized batch — these are the safest changes).
8. `aigon server restart` after any `lib/*.js` edit.

### Risks / things that have bitten us before

- **localStorage migration** — users with `aigon_filter=submitted` saved will see the filter chip stuck on a non-existent bucket. The one-line shim above handles it.
- **Playwright selectors** — any existing tests that target the **N submitted** pill text need updating. Grep `tests/**/*.spec.{js,ts}` for `submitted` and `Submitted`.
- **Don't accidentally rename `.status-submitted` CSS class globally** — `pipeline.js:344`'s `cls: 'status-submitted'` is an internal style hook reused by review-complete states (`pipeline.js:340,335` etc.). Rename labels, not classes.
- **Engine state `submitted` is not the same thing** — `lib/state-render-meta.js:16` and `lib/feature-workflow-rules.js` are engine lifecycle, not agent-status. Verify the file you're editing before changing any string.

## Dependencies

- Depends on F404 (already shipped — provides the canonical agent-status vocabulary this feature aligns the UI with).

## Out of Scope

- Renaming the `signal.agent_submitted` event type or `submittedAt` field name on agent-status records (internal wire/storage names; larger refactor).
- Renaming the `agent-submitted` / `all-submitted` notification event types on the wire.
- Renaming the `.status-submitted` CSS class (internal style hook).
- Engine-side workflow state names in `lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js` / `lib/state-render-meta.js` — these are workflow lifecycle, not agent-status.
- Any change to the deprecation behaviour in `lib/commands/misc.js:223-238` — the CLI alias remap stays; this feature only updates the rendering layer that should never see the aliases anyway.

## Open Questions

- Does any external integration consume `summary.submitted` from the dashboard's JSON API? If yes, keep `summary.submitted` as a duplicate alongside `summary.complete` for one release. (Trace: `grep -rn "summary.submitted" .` and check `aigon-pro` if accessible.)
- Should the **complete** pill split fleet vs solo (e.g. show "3/4 complete" when partial in a fleet)? Out of scope unless the trace shows the existing pill already does this for `submitted`.

## Related

- Research: —
- Set: F404 follow-on (rendering + docs alignment after the wire rename)
- Prior features in set: F404
