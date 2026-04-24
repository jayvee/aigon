---
complexity: high
---

# Feature: close-failure-event-and-resolve-action

## Summary

When `aigon feature-close` fails (most commonly from merge conflicts against main during solo-worktree autopilot runs), the reason disappears with the conductor's tmux pane. `.aigon/state/feature-<id>-auto.json` records a terse `"reason": "feature-close-failed"` but no details — no conflict file list, no stderr. The dashboard shows "Close: Failed" with nothing actionable.

This feature fixes the gap in two layers:

1. **Persist the failure.** `feature-close` emits a new `feature_close.failed` event into `.aigon/workflows/features/<id>/events.jsonl` with a structured payload (`kind`, `conflictFiles[]`, `stderrTail`, `at`). The event is a first-class citizen — projector handler, read-model surfaces it, snapshot exposes it.
2. **Surface an escalation.** When the snapshot shows a recent `feature_close.failed` with `kind: 'merge-conflict'`, the dashboard swaps the "Close" button for **"Resolve & close"** — which runs `aigon feature-open <id>` with a pre-injected prompt instructing the agent to rebase onto main, resolve the conflicts, and re-run `aigon feature-close`. The plain "Close" button remains the default for the happy path.

Evidence the gap exists: F333 (`robust-hook-binary-resolution`) failed to close at 2026-04-24T01:35:54 with merge conflicts in `feature-335-…md` and `lib/commands/setup.js`; recovery required reproducing the run manually because the autopilot forensics were gone.

## User Stories

- [ ] As an Aigon user, when my autopilot feature fails to close, the dashboard tells me *why* (e.g. "Merge conflict in 2 files: X, Y") — not just "Failed".
- [ ] As an Aigon user, I click a single button to launch an agent that rebases and resolves the conflicts — no terminal gymnastics.
- [ ] As an Aigon user running a feature days later, I can still see the conflict details in `events.jsonl` after the conductor tmux session is long gone.
- [ ] As an Aigon developer, a `feature_close.failed` event in the workflow log is the canonical record of the failure — the projector, read-model, and dashboard all derive from it.

## Acceptance Criteria

**Event emission (persistence layer)**
- [ ] New event type `feature_close.failed` appended to `.aigon/workflows/features/<id>/events.jsonl` whenever `aigon feature-close` exits non-zero.
- [ ] Event payload: `{ type: 'feature_close.failed', featureId, kind, conflictFiles?, stderrTail, exitCode, at }` where:
  - `kind` is one of `'merge-conflict'`, `'security-scan'`, `'push-failed'`, `'test-failed'`, `'other'` — classified by parsing `feature-close`'s error output.
  - `conflictFiles: string[]` is populated when `kind === 'merge-conflict'`.
  - `stderrTail` is the last ~40 lines of combined stdout+stderr, capped at ~4KB (don't let giant scan outputs bloat the event log).
- [ ] Event is emitted from the `feature-close` command itself (single source of truth), not from the autopilot conductor separately — the conductor merely detects the non-zero exit and keeps going.
- [ ] Autopilot's auto-state `reason: "feature-close-failed"` retained for back-compat, but the rich detail lives on the event.

**Projector / read-model**
- [ ] `lib/workflow-core/projector.js` adds a handler for `feature_close.failed` that records `lastCloseFailure: { kind, conflictFiles, stderrTail, at }` on the projected snapshot state.
- [ ] `lib/workflow-read-model.js` exposes `lastCloseFailure` on the snapshot returned to the dashboard.
- [ ] `lastCloseFailure` is cleared (set to `null`) whenever a subsequent successful close emits `feature.closed` — the failure log in events.jsonl stays; only the snapshot pointer clears.

**Dashboard surface**
- [ ] When `lastCloseFailure.kind === 'merge-conflict'` and the feature is still in `implementing` lifecycle, the "Close" action button is replaced with **"Resolve & close"** (new `ManualActionKind` entry, e.g. `FEATURE_RESOLVE_AND_CLOSE`).
- [ ] Clicking "Resolve & close" triggers `aigon feature-open <id>` with a pre-injected prompt. Prompt text (draft): *"The last close attempt failed with merge conflicts against main in these files: {conflictFiles}. Rebase this branch onto main (`git rebase main`), resolve the conflicts, commit the resolution, then run `aigon feature-close <id>` to retry."*
- [ ] The feature card surfaces the failure inline: a compact line under "Close: Failed" reading e.g. `Merge conflict in feature-335-…md, lib/commands/setup.js` — clickable to expand `stderrTail`.
- [ ] For non-`merge-conflict` failure kinds, the button stays "Close" (retrying may just work); the inline line still shows the classification and stderr tail.

**Autopilot behaviour**
- [ ] Autopilot conductor does **not** auto-retry with an agent on close failure — it records the event, persists the auto-state failure reason, and exits cleanly (current behaviour, preserved).
- [ ] Deferred: transient-vs-structural failure classification + targeted auto-retry. Captured in Out of Scope.

**Tests**
- [ ] Integration test: simulate a `feature-close` merge-conflict exit → assert `feature_close.failed` event appended with `kind: 'merge-conflict'` and `conflictFiles` populated from the close command's stderr.
- [ ] Integration test: projector consumes the event and exposes `lastCloseFailure` on the snapshot; a subsequent `feature.closed` clears it.
- [ ] UI test (Playwright): snapshot fixture with `lastCloseFailure.kind === 'merge-conflict'` renders "Resolve & close" button; snapshot without the failure renders plain "Close".
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` green.

**Docs**
- [ ] `docs/architecture.md` notes the new event type in the workflow event taxonomy.
- [ ] `CHANGELOG.md` entry: "Feature close failures are now persisted to the workflow event log and surfaced in the dashboard; merge-conflict failures get a one-click 'Resolve & close' escalation."

## Validation

```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised

- May restart the Aigon dashboard server after any `lib/*.js` edit (per CLAUDE.md hot rule 3).
- May take Playwright screenshots for dashboard verification (per CLAUDE.md hot rule 4).

## Technical Approach

**1. Classify failures at the source.**

In `lib/feature-close.js`, wrap the existing error-exit paths with a small helper that parses the collected stderr and returns a structured classification:

```js
function classifyCloseFailure(stderr) {
    if (/CONFLICT \(content\):/i.test(stderr)) {
        const conflictFiles = Array.from(stderr.matchAll(/CONFLICT \(content\): Merge conflict in (.+)/g))
            .map(m => m[1].trim());
        return { kind: 'merge-conflict', conflictFiles };
    }
    if (/Security scan failed|gitleaks: .*detected/i.test(stderr)) return { kind: 'security-scan' };
    if (/push .* rejected|failed to push/i.test(stderr)) return { kind: 'push-failed' };
    if (/Test .*failed|jest.*failed|tests? failed/i.test(stderr)) return { kind: 'test-failed' };
    return { kind: 'other' };
}
```

The existing close error sites (line 350 `❌ Git command failed`, line 710 resume errors, etc.) each call a single `recordCloseFailure(repoPath, featureId, stderr, exitCode)` helper that classifies + appends the event.

**2. Append the event.**

Use the existing event-log append path (`lib/workflow-core/engine.js` or the current canonical appender — verify during implementation). Cap `stderrTail` at 4KB. Event-type constant lives in `lib/workflow-core/events.js` alongside others.

**3. Projector handler.**

`lib/workflow-core/projector.js` — add case for `feature_close.failed`:

```js
case 'feature_close.failed':
    draft.lastCloseFailure = {
        kind: event.kind,
        conflictFiles: event.conflictFiles || [],
        stderrTail: event.stderrTail || '',
        at: event.at,
    };
    break;

case 'feature.closed':
    draft.lastCloseFailure = null;
    break;
```

Exact API follows the existing projector pattern.

**4. Read-model & snapshot shape.**

`lib/workflow-read-model.js` — surface `lastCloseFailure` on the returned snapshot. No change to the legacy `auto-state` file; this is additive.

**5. New action kind.**

`lib/workflow-core/types.js` — add `FEATURE_RESOLVE_AND_CLOSE` to `ManualActionKind`.

`lib/action-scope.js` + `lib/action-command-mapper.js` — when `snapshot.lastCloseFailure?.kind === 'merge-conflict'` and lifecycle is `implementing`, replace the `FEATURE_CLOSE` action with `FEATURE_RESOLVE_AND_CLOSE`. The mapper dispatches `FEATURE_RESOLVE_AND_CLOSE` to `aigon feature-open <id> --prompt "<resolve-conflict-prompt>"` — verify during Phase 1 whether `feature-open` already accepts a canned prompt; if not, extend it with a minimal `--prompt` flag.

**6. Dashboard rendering.**

`templates/dashboard/js/actions.js` — new case for `FEATURE_RESOLVE_AND_CLOSE` (label "Resolve & close", distinct warning style). Feature card adds an inline failure line rendered from `snapshot.lastCloseFailure` with expand-to-see-stderr behaviour.

**7. Autopilot stays hands-off.**

`lib/feature-autonomous.js` lines 476–480 (solo path) and 619–623 (fleet path) are unchanged in behaviour — they still finish-auto with `reason: 'feature-close-failed'`. The new event is emitted by `feature-close` itself, so the conductor gets the rich record for free.

**Non-functional constraints:**
- **Write-path contract (F294 lesson):** `feature-close` is the sole producer of `feature_close.failed`. No other code path emits it. Projector handler is the sole consumer that writes to snapshot state. Grep for the event name before merging — two hits only (emitter + handler) plus tests.
- **Event log is the source of truth.** The snapshot's `lastCloseFailure` is cache-like — reconstructable by replaying `events.jsonl`. If the snapshot is nuked, the next projector rebuild re-derives it.
- **stderrTail cap.** 4KB hard limit. Security-scan output alone can run 100+ KB; we only need enough to diagnose.

## Dependencies

- None — self-contained. Touches the same modules the workflow event system already lives in.

## Out of Scope

- **Transient-vs-structural failure classification for auto-retry.** Capture the *kind* here, but don't build auto-retry logic yet. Defer until real failure data shows retry would actually help (e.g. flaky push timeouts).
- **Agent-driven conflict resolution of spec files.** The escalation agent resolves code conflicts; resolving *spec* conflicts (like the F335 case) may still want human review. The pre-injected prompt can note "pause for human review on spec conflicts" but we're not enforcing it in the agent harness.
- **Auto-rebasing the feature branch before close.** Could prevent many conflicts, but changes the `feature-close` contract and risks silent drift — separate feature.
- **Cross-feature concurrency locking.** F333 hit a conflict because F335 landed on main mid-session. Serializing autopilot runs is out of scope.

## Open Questions

- Does `aigon feature-open` already support a `--prompt` flag or equivalent canned-message injection? If not, we need to add one; if so, reuse it. Resolve during Phase 1 exploration.
- Should `stderrTail` be the last 40 lines verbatim or a smarter "error-region extract" (lines after the first `❌` marker)? Probably smarter — the last 40 lines of a semgrep scan is just more scan output. Resolve during implementation.
- Should the failure line render on the Kanban card itself (compact) or only in the expanded feature view? Suggest: compact line on the card, full stderr in the expanded view.

## Related

- F333 (`robust-hook-binary-resolution`) — the incident that surfaced this gap.
- F335 (`rename-review-check-to-revise`) — unrelated but will interact if both ship close together (events.jsonl schema additions should not collide with the review→revise event renames).
