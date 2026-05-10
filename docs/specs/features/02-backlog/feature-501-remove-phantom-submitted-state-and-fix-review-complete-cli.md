---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T10:17:12.272Z", actor: "cli/feature-prioritise" }
---

# Feature: remove-phantom-submitted-state-and-fix-review-complete-cli

## Summary

The `submitted` state is a phantom: the engine state machine, the agent-status enum, AGENTS.md, dashboard CSS, and many tests all treat `submitted` as a real lifecycle/agent-status target, but in production it is essentially never traversed. Across features 481→500 (last 19), zero agents ever reached `status: submitted`, zero events recorded `"submitted"` as a status value, and only one feature (f495) ever landed at `lifecycle: submitted` — and that one did so because the cu reviewer was forced to bypass the CLI. Real flows go `implementing → ready → done`.

The reason the phantom keeps re-surfacing is two-fold:
1. **`aigon agent-status review-complete` is broken for clean approvals** — `lib/commands/misc.js:506-510` hard-codes `requestRevision: true`, so every clean code review is forced into a code-revision cycle. There is no CLI flag to express "approve as-is."
2. **`AGENTS.md:19` documents the engine bypass verbatim**, naming `submitted` and `requestRevision: false` as the path agents should take. cu (and any future reviewer) reads it and acts on it.

This feature removes `submitted` as a first-class state from the engine, types, projector, paths, agent-status enum, dashboard render meta, card-headline mapper, autonomous gates, eval gates, AGENTS.md and other agent-facing docs, and all tests/fixtures — replacing the transient `code_review_complete (no revision) → submitted → done-eligible` arc with a direct `code_review_complete (approve) → ready` transition. It also fixes the `review-complete` CLI to accept `--approve` / `--request-revision` so reviewers never need to call the engine directly.

## User Stories
- [ ] As a reviewer, I can run `aigon agent-status review-complete --approve` for a clean approval and have the feature transition correctly without needing to bypass the CLI.
- [ ] As a reviewer, I can run `aigon agent-status review-complete --request-revision` (or just `review-complete`, with `--request-revision` as the explicit-but-default behaviour for safety) when fixes are needed.
- [ ] As an implementing agent, after a clean code review I see a single, unambiguous next action (`feature-close`) — never a stale `submitted` lifecycle requiring me to guess between `revision-complete` and `feature-close`.
- [ ] As a maintainer reading AGENTS.md, I never encounter documentation of a phantom state that real flows do not traverse.
- [ ] As a maintainer running grep for `submitted` in `lib/`, I see only intentional, explained references (e.g. backward-compat aliases for the deprecated `agent-status submitted` CLI subcommand, with a clear deprecation timeline).

## Acceptance Criteria

### Engine state machine
- [ ] `lib/feature-workflow-rules.js` and `lib/research-workflow-rules.js` no longer have `submitted` as a target state. Transitions previously routing through `submitted` route directly to `ready` (or the equivalent close-eligible state).
- [ ] `lib/workflow-core/types.js` no longer exports `SUBMITTED`. Any consumer importing it is updated.
- [ ] `lib/workflow-core/machine.js` removes the `submitted` target from `code_review_complete` transitions. Clean approvals route to `ready`/close-eligible directly.
- [ ] `lib/workflow-core/projector.js` removes every branch that sets `lifecycle = 'submitted'` or `currentSpecState = 'submitted'`. Equivalent branches set `ready`.
- [ ] `lib/workflow-core/paths.js` removes the `submitted` → `03-in-progress` mapping (folder mapping for `ready` already covers this).
- [ ] `lib/workflow-snapshot-adapter.js` removes `submitted` from its lifecycle-mapping table (currently maps `ready: 'submitted'` — the inverse direction).
- [ ] Replay-test: replay all events from features 481→500 against the new projector and assert no snapshot ever has `lifecycle === 'submitted'`. (Should already be true empirically, but adding a regression test prevents reintroduction.)

### Agent-status enum + CLI
- [ ] `lib/state-queries.js:32` AGENT_STATUSES no longer contains `'submitted'`. Replace with the actual valid set: `['idle', 'implementing', 'waiting', 'ready', 'error']`.
- [ ] `lib/agent-status.js:154` agent-status validation no longer accepts `'submitted'` as a current status.
- [ ] `lib/commands/misc.js`: `'submitted'` is removed from the deprecated-alias remap path. Any agent that runs `aigon agent-status submitted` gets a hard error: `"agent-status submitted is no longer supported — use implementation-complete (initial) or revision-complete (after review fixes)."` (Hard error, not a deprecation warning. The deprecation already shipped in F339; agents that still call it have a stale install — see Spec B for the install-drift fix.)
- [ ] `lib/commands/misc.js` `review-complete` branch: accept `--approve` and `--request-revision` flags. Default (no flag) prints an error requiring an explicit choice. Update `recordCodeReviewCompleted` call to use the flag value, not hard-coded `true`.
- [ ] Update `templates/generic/commands/feature-code-review.md` Step 5 to instruct the reviewer to run `aigon agent-status review-complete --approve` (clean review) or `aigon agent-status review-complete --request-revision` (fixes requested). Reinstall to all installed agents (manual `aigon install-agent --all`; install-drift auto-fix is Spec B).

### Dashboard + read paths
- [ ] `lib/state-render-meta.js`: remove `submitted` entry. `done` no longer aliases to `status-submitted` CSS class — rename CSS class to `status-ready` (or `status-done`) project-wide.
- [ ] `lib/card-headline.js`: remove the `submitted` headline mapping. Ensure card headline still produces a sensible label for `ready` features awaiting close.
- [ ] `lib/dashboard-status-collector.js`: remove `submitted` from the lifecycle and member status branches.
- [ ] `lib/dashboard-status-helpers.js`: remove `submitted` from the dashed-status check.
- [ ] `lib/dashboard-server.js:1671`: notification summary keys no longer include `submitted`.
- [ ] `lib/dashboard-server.js:1778`: NOTIFICATION_TYPES no longer contains `'agent-submitted'` or `'all-submitted'` / `'all-research-submitted'`. Rename to `agent-ready` / `all-ready` and update emit sites.
- [ ] `templates/dashboard/index.html` + CSS: any selector targeting `.status-submitted` is renamed or removed. Browser MCP snapshot taken after the change (per CLAUDE.md hot rule 4).

### Documentation
- [ ] `AGENTS.md:19` rewritten to remove the engine-bypass instruction. Replacement text describes the supported CLI flags only (`--approve` / `--request-revision`), with no mention of `recordCodeReviewCompleted` or `requestRevision: false` as a user-facing affordance.
- [ ] `docs/architecture.md:308,328,341` references to `submitted` rewritten in terms of `ready` (or removed where the reference was to the phantom transition specifically).
- [ ] `docs/workflow-rules.md`: 8 references to `submitted` rewritten as `ready` or removed.
- [ ] `docs/dashboard.md`: any reference to `submitted` updated.

### Stale .cursor rules
- [ ] Delete `.cursor/aigon-afsb.md`, `.cursor/aigon-afi.md`, `.cursor/aigon-arsb.md` if they are no longer regenerated by `aigon install-agent cu`. Verify by running `aigon install-agent cu --dry-run` (or grep `templates/` for their source) — if nothing in templates produces them, they are pure orphans and removing them is safe.

### Tests
- [ ] `tests/integration/submit-signal-loss.test.js`: rewrite to use `implementation-complete` instead of `submitted`. Test name + comments updated.
- [ ] `tests/integration/mock-agent.js` + `tests/integration/mock-agent-tmux.test.js`: replace `agent-status submitted` calls with `agent-status implementation-complete`.
- [ ] `tests/dashboard-e2e/*.spec.js` (mark-complete, fleet-lifecycle, workflow-e2e, solo-lifecycle): replace `.status-submitted` selectors with the new class name. Replace `agent-status submitted` CLI calls with `implementation-complete`.
- [ ] `tests/integration/lifecycle.test.js`, `tests/integration/feature-close-recovery-state.test.js`, `tests/integration/static-guards.test.js`, `tests/integration/awaiting-input-dashboard.test.js`, `tests/integration/dashboard-review-statuses.test.js`, `tests/integration/aigon-eval.test.js`, `tests/integration/card-headline.test.js`, `tests/integration/review-cycle-loopback.test.js`, `tests/integration/review-cycle-redesign-states.test.js`, `tests/workflow-core/review-cycles-projection.test.js`: review each, replace `submitted` assertions with `ready`/correct successor state.
- [ ] `tests/integration/aigon-eval.test.js:112` — `expectedFinalState` for features defaults to `submitted`; change to `done` (or whatever the canonical post-close state is).
- [ ] `templates/aigon-eval/workloads/feature/expected.json` and `templates/aigon-eval/workloads/research/expected.json` — replace `submitted` expectations.

### One-time data migration for f495
- [ ] As part of the implementation, the f495 snapshot has `lifecycle: submitted`. Provide a migration step (one-shot script or `aigon doctor --fix` branch) that rewrites it to `ready`/`done` per the engine's new mapping. Verify f495 closes cleanly afterward. (This is the immediate unblock for the user.)

## Validation

```bash
node -c lib/commands/misc.js
node -c lib/workflow-core/projector.js
node -c lib/workflow-core/machine.js
npm run test:iterate
# After: grep -rn '\bsubmitted\b' lib/ AGENTS.md docs/architecture.md docs/workflow-rules.md docs/dashboard.md | grep -v 'docs/specs/features/(05-done|06-paused|logs|evaluations)' | grep -v 'submittedAt\|submitText\|submission'
# Above grep must return zero hits in live code/docs (historical specs and the `submittedAt` timestamp field name are exempt).
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May rename CSS class `status-submitted` → `status-ready` across `templates/dashboard/`, `lib/state-render-meta.js`, and all Playwright spec selectors as a single mechanical sweep without separate sign-off.
- May rename notification types `agent-submitted` / `all-submitted` / `all-research-submitted` → `agent-ready` / `all-ready` / `all-research-ready` across emit sites and any client-side listener.

## Technical Approach

**Engine first, then read paths, then docs, then tests.** This is a write-path-contract change — any read path that still consumes `submitted` after the engine stops producing it would surface as `undefined`/blank UI, not a loud failure. Order matters.

**Strategy:**
1. **Replay validation up-front.** Before any code edit, write a one-off script that replays every event log under `.aigon/workflows/features/*/events.jsonl` against the *current* projector, then against a candidate new projector with `submitted` removed, asserting no closed feature changes its final lifecycle. This is the safety net for the engine surgery.
2. **Engine rewrite.** Update `feature-workflow-rules.js`, `research-workflow-rules.js`, `workflow-core/machine.js`, `workflow-core/projector.js`, `workflow-core/types.js`, `workflow-core/paths.js`, `workflow-snapshot-adapter.js`. Run `npm run test:iterate` after each file.
3. **Agent-status CLI surgery.** `lib/commands/misc.js` — add the `--approve` / `--request-revision` flag handling, remove the `submitted` deprecated alias, harden enum.
4. **Read-path sweep.** `state-queries.js`, `agent-status.js`, `dashboard-status-collector.js`, `dashboard-status-helpers.js`, `card-headline.js`, `state-render-meta.js`, `dashboard-server.js` notification types.
5. **Dashboard CSS rename.** Single mechanical sweep `status-submitted` → `status-ready`. Browser MCP snapshot.
6. **Docs sweep.** AGENTS.md, architecture.md, workflow-rules.md, dashboard.md.
7. **Tests.** Update assertion text. The replay validator in step 1 doubles as the regression test.
8. **Stale .cursor cleanup.** Remove orphan files; reinstall agents.
9. **f495 migration.** One-shot fix-up applied via `aigon doctor --fix` branch, verified by closing f495.

**Constraint — backward compatibility for existing snapshots.** Some on-disk snapshots may still hold `lifecycle: submitted` (e.g. f495 today, plus any older closed feature whose log nobody has compacted). The projector must `console.warn` once per offending snapshot and rewrite to `ready` on next projection. Do **not** silently drop the field.

**Non-functional:** the rename does not change any user-visible URL, API endpoint name, or event type name. `feature.code_review.completed` event keeps its name and `requestRevision` field — they were never the problem. The only event-shape change is that the projector branch consuming `requestRevision: false` now emits `lifecycle: ready` directly.

## Dependencies
- None hard. Spec B (template drift guard) is independent and will be filed separately. After Spec A lands, manual `aigon install-agent --all` is needed to push the new `feature-code-review.md` Step 5 wording out to every agent's installed copy — Spec B will automate that going forward.

## Out of Scope
- The template/install drift fix (Spec B).
- Any change to `feature.close_recovery.*` event semantics (close-recovery currently uses `returnSpecState: 'submitted'` as a metadata field — that string will be remapped to `'ready'` at projection time, but the event-payload field name is unchanged for backward compat with on-disk events.)
- Removing the deprecated `agent-status feedback-addressed` alias — same shape of problem but a separate cleanup.
- Renaming `signal.agent_submitted` to `signal.agent_ready` — that's a stable internal signal name with replay implications; leave it as-is and document that the signal name is historical.
- Renaming the projector's `submittedAt` timestamp field on review records — it's a timestamp ("when was the review submitted by the reviewer"), not a state name; leave it alone.

## Open Questions
- The `agent-status submitted` deprecated alias was kept for ~30+ commits with a deprecation warning. Hard-erroring it now will break any agent running a stale install. Do we want a 1-week hard-error grace window where the warning escalates to an error, or hard-error on this PR? (Recommendation: hard-error now. Agents are software; the warning has been there long enough; install-drift is Spec B's problem.)
- For `lib/dashboard-server.js` notification types: do we keep the old type names as aliases for one release for any external listener (Slack, etc.)? Recommendation: no — the types are internal SSE events to the dashboard's own client.

## Related
- Research: —
- Set: —
- Prior features in set: F285, F293, F332 (implementation-log/submit ordering — same general region of code, all done).
- Companion: Spec B (template drift guard) — to be filed next.
- Incident: f495 (review by cu landed at `lifecycle: submitted`, blocked the implementer's `revision-complete` call). This spec includes a one-shot migration to unblock f495.
