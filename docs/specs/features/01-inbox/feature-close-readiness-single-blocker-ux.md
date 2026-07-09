---
complexity: high
depends_on: [650, 646, 647, 644, 428, 432]
---

# Feature: close-readiness single-blocker UX

## Summary

The close-integrity stack (criteria attestation F647, review escalations F646, pre-auth validation, post-merge gate F644, close recovery F432, live close log F428) made feature close **safer** but the **operator experience is broken**. Cards routinely show contradictory signals at equal weight — e.g. green **"Starting close"** and **"Ready to close"** while **Manual mode** reports an open escalation blocking close; duplicate **Close with agent** buttons; a progress timeline that reads "everything succeeded" above a failure headline; and escalation disposition buttons whose labels ("Accept escalation") do not explain what the operator is deciding.

F650 shipped card hierarchy rules, but close-readiness was not modelled as a **single authoritative blocker**. This feature adds a server-owned **close readiness / blocker** projection on every feature row, rewires headline, timeline, autonomous plan, and action priority to honour it, and renames escalation disposition copy for plain language. Goal: an operator can answer **"what is blocking close, and what is the one thing I click?"** in under five seconds — without reading six panels.

**Inciting incidents (2026-07-09):** F654 — autonomous close fired before criteria attestation, three `close_gate_failed` cycles, recovery UI opaque; F656 — OP-approved feature with `ambiguous` escalation shows "Starting close" + "Ready to close" + "Manual mode" + three escalation buttons simultaneously.

## User Stories

- [ ] As an operator on a feature ready to close, I see **one** dominant status that names the blocker (or "Ready to close" when nothing blocks) and **one** primary action — not five competing greens and reds.
- [ ] As an operator facing an open review escalation, I understand what **Acknowledge & proceed**, **Track as follow-up**, and **Send back for revision** mean without reading F646's spec.
- [ ] As an operator while `feature-close` runs, the live log panel is the source of truth for progress; the card headline does not claim "Starting close" when close is not actually running.
- [ ] As an operator after a close gate failure, I see the **specific gate** (criteria / escalation / preauth / post-merge / merge conflict) as the blocker label, with the log path or missing log section named in context — not a generic "Close failed" repeated four times.
- [ ] As an operator with `postMergeGate` configured, I understand close will take time and see which phase is running in the close-log panel — the card does not spin silently.
- [ ] As an agent implementing future dashboard card changes, I consult one documented **close-readiness contract** (`docs/dashboard-card-design.md` § Close readiness) and cannot reintroduce `kcard-ready-indicator` or autonomous handoff headlines when `closeBlockers.length > 0`.

## Acceptance Criteria

### Server: close readiness projection

- [ ] `lib/close-readiness.js` (or equivalent owner) exports `buildCloseReadiness(entity, snapshot, options)` returning a stable DTO, e.g. `{ ready, blockers[], primaryBlocker, phase, closeLogHint }` where each blocker has `{ kind, label, detail, actionKind?, actionCommand? }`.
- [ ] Blocker kinds cover at minimum: `open-escalation`, `criteria-attestation`, `preauth-validation`, `post-merge-gate`, `merge-conflict`, `close-recovery`, `autonomous-stopped`, `eval-pick-winner`, `awaiting-input`, `dependency-blocked`. Unknown `lastCloseFailure.kind` degrades to a generic `close-gate` blocker with stderr tail — never silent.
- [ ] `open-escalation` blockers enumerate count + first-line reason; disposition is required before `ready: true`.
- [ ] `criteria-attestation` blocker lists missing criterion indices (from log parse or snapshot) until satisfied.
- [ ] `ready: true` only when engine `canCloseFeature` would pass **and** no open escalations **and** no active close-recovery gate failure — mirror the same ordering as `feature-close` phases (escalation → criteria → preauth → merge → post-merge), do not invent new gates.
- [ ] `buildCloseReadiness` is **advisory, cheap, and derived** — it evaluates snapshot fields and shared predicates extracted from `feature-close` (per Technical Approach §1); it must **never invoke the close path** or spawn a git subprocess per row (the `merge-conflict` blocker reads recorded `lastCloseFailure`, it does not run a live merge probe). `feature-close` remains the sole enforcement authority; a `ready: true` projection that the real close then rejects is a bug in the shared predicate, not a reason to fork the logic.
- [ ] DTO carries an `applicable: boolean` — `false` for rows that have not reached a close-relevant stage (pre-review lifecycle). When `applicable: false`, headline/presentation precedence skips `closeReadiness` entirely so early-pipeline cards are not hijacked by e.g. `dependency-blocked` (which keeps its existing pre-start surfacing). `dependency-blocked` and `eval-pick-winner` appear as blockers only in the stages where they actually gate close.
- [ ] Collector attaches `closeReadiness` to every feature row in `/api/status`; field is listed in `computeStatusFingerprint` (`lib/dashboard-status-version.js`) so SSE repaints when blockers change — the existing `lastCloseFailure`/`openEscalations` fingerprint terms are subsumed, not duplicated.

### Headline and presentation precedence

- [ ] `computeCardHeadline` consults `closeReadiness.primaryBlocker` **before** autonomous-plan handoff labels (`Starting close`, `Starting review`, …). When any close blocker exists, autonomous handoff headlines are suppressed.
- [ ] `buildCardPresentation` suppresses `readyToClose`, duplicate close-failure panels, and contradictory timeline rows per F650 rules **using `closeReadiness` as source of truth** — not ad-hoc per-field checks scattered in `pipeline.js`.
- [ ] `kcard-ready-indicator` ("✓ Ready to close") renders **only** when `closeReadiness.ready === true`. Never when `openEscalations.length > 0` or `lastCloseFailure` is set.
- [ ] When autonomous controller is `stopped` with `reason: escalation-pending`, headline reads **Blocked: review escalation** (or server label), tone `attention`/`blocked` — not `running` / "Starting close".
- [ ] The autonomous-status panel (`templates/dashboard/js/pipeline.js` ~line 894, `stopped` → label **"Manual mode"**) must not render as a second panel repeating the blocker the headline already carries — when the headline shows the primary blocker, the panel collapses to a single secondary line (or is suppressed per F650 dedupe rules). "Manual mode" as a panel title tells the operator nothing; if kept, retitle from the stop reason.

### Escalation disposition copy (dashboard + CLI help)

- [ ] Dashboard `validActions` labels for escalation disposition use operator language:
  - `feature-escalation-accept` → **Acknowledge & proceed** (tooltip: record that you accept the reviewer's flagged concern and continue toward close)
  - `feature-escalation-follow-up` → **Track as follow-up feature**
  - `feature-escalation-reopen` → **Send back for revision**
- [ ] Escalation badge on card: `N escalation(s) blocking close` — not opaque "1 escalation".
- [ ] `lib/feature-escalation-dashboard-actions.js` (or action registry) updated; frontend renders labels from server `validActions` only. **Known violation to remove:** `templates/dashboard/js/actions/escalation.js` currently hard-codes `'Accept escalation'` as a client-side label — delete or delegate that fallback in the same commit.
- [ ] Existing label assertions updated in the same commit (`tests/integration/feature-escalation.test.js` and any Playwright specs matching the old strings) — grep for `Accept escalation`, `Follow-up from escalation`, `Reopen for revision` before declaring done.

### Actions: one primary

- [ ] When `closeReadiness.primaryBlocker.actionKind` is set, the matching disposition/close action is the **sole primary button** on the card; Close, Recover, and escalation actions are not co-primary.
- [ ] REGRESSION: only one **Close with agent** / **Resolve & close** button (F650 + F519 duplicate guard retained).
- [ ] When blockers are empty and lifecycle is `ready`, **Close** is primary; autonomous **Recover** is secondary unless autonomous failed.

### Close-log panel coupling

- [ ] While dashboard `feature-close` is in flight, card headline shows **Closing…** (or phase from streamed log prefix) — not "Starting close" from plan handoff.
- [ ] On close failure, headline context includes `closeReadiness.primaryBlocker.detail` (gate command, missing criteria indices, escalation excerpt) — close-log panel footer keeps **Close with agent** as secondary recovery path.

### Autonomous conductor alignment

- [ ] AutoConductor pause reasons (`escalation-pending`, `criteria-attestation` wait) map to the same blocker kinds the dashboard shows — operator sees the same vocabulary in tmux logs and on the card.
- [ ] Document in implementation log if any autonomous-only blockers remain outside `closeReadiness` (should be none for close path).

### Tests

- [ ] Unit: `buildCloseReadiness` fixtures for F656-shaped row (ready lifecycle + open ambiguous escalation + autonomous stopped) → `ready: false`, primary blocker `open-escalation`, no autonomous handoff headline when projected.
- [ ] Unit: criteria-attestation missing → blocker lists indices; after `feature.criteria_attested` event → `ready` true (escalations clear).
- [ ] Integration: escalation blocks close; after `feature-escalation accept` → `closeReadiness.ready` true (criteria permitting).
- [ ] Playwright @smoke: fixture with open escalation shows **no** `.kcard-ready-indicator`, headline does not contain "Starting close", exactly one primary action for escalation accept.
- [ ] Playwright: close-failure-event spec still passes; add escalation-pending fixture scenario.

### Docs

- [ ] `docs/dashboard-card-design.md` — new § **Close readiness** documenting `closeReadiness` DTO, blocker kinds, headline precedence over autonomous plan, and "never show Ready to close when blockers exist".
- [ ] `docs/card-design-wireframe.html` — add close-blocked and escalation-blocked reference cards.
- [ ] `AGENTS.md` § Dashboard read-only rule — mention `closeReadiness` as the dashboard's close authority (read from collector, not hand-parsed in frontend).

## Validation

```bash
node --check lib/close-readiness.js
node --check lib/card-headline.js
node --check lib/card-presentation.js
node --check lib/dashboard-collect/feature-poll.js
npm run test:iterate
```

```bash
npm run test:deploy
```

Interactive UI: `aigon preview <ID>` on a worktree with escalation-pending and close-failed fixtures; screenshots to `./tmp/`.

## Pre-authorised

- May skip full `test:browser` mid-iteration when touching only `lib/close-readiness.js` and unit tests; smoke subset runs via iterate gate when dashboard paths change.
- May add dashboard fixture rows for escalation-pending and criteria-missing without a new engine state.

## Technical Approach

### 1. Single read model: `buildCloseReadiness`

New module `lib/close-readiness.js` — leaf-ish, imports:
- `criteria-attestation` (`criteriaAttestationReady`)
- `review-escalation` (`getOpenEscalations`, `formatEscalationCloseBlockMessage` excerpts)
- `workflow-core` snapshot fields (`lastCloseFailure`, `closeRecovery`, `openEscalations`)
- optional: lightweight preauth/criteria preview helpers already in `feature-close` (extract shared predicates, do not duplicate full close)

Return blockers in **close phase order**; `primaryBlocker = blockers[0]`.

Wire in `lib/dashboard-collect/feature-poll.js` after snapshot read (same poll as `cardHeadline` / `cardPresentation`). Note: `computeCardHeadline` is invoked at **three call sites** in that file (~lines 217, 453, 532 — fleet/drive/late-attach paths); `closeReadiness` must be computed once per row and passed to **all** of them, or the F656 contradiction just moves to whichever path was missed.

### 2. Rewire headline + presentation

- `lib/card-headline.js` — accept `closeReadiness` param (or read from entity); insert precedence block after warn-class close failure / before autonomous plan §8.
- `lib/card-presentation.js` — `suppress.readyToClose = !closeReadiness.ready`; timeline omits duplicate "Close failed" when headline already carries it.
- `templates/dashboard/js/pipeline.js` — `buildReadyToCloseHtml` gates on `feature.closeReadiness.ready`; remove client-side escalation-blind ready checks.

### 3. Escalation labels

- `lib/feature-escalation-dashboard-actions.js` — update `label` strings on appended `validActions`; keep `action` ids unchanged for CLI routing.
- Optional: `reason` metadata for dashboard tooltips via existing `validActions.metadata`.

### 4. Close-log headline sync (lightweight)

- When `activeActionLogs` has in-flight `feature-close` for this feature id, set headline verb **Closing…** — defer WebSocket streaming to F428 scope; polling statusVersion is enough for v1. Implementation caveat: `activeActionLogs` lives on the server/routes side (`lib/dashboard-server.js`, `lib/dashboard-routes/system.js`), not in the collector — either expose an in-flight-close lookup to the collector or set a `closingInProgress` flag on the row at action-dispatch time; pick one, don't do both.

### 5. F650 gap closure

F650 defined hierarchy but did not define **close blocker authority**. This feature is the missing data layer F650 assumed. Do not re-litigate full card redesign — fix close/escalation/autonomous contradictions only.

## Dependencies

- **F650** (done) — card hierarchy vocabulary; this feature adds `closeReadiness` and enforces it.
- **F646** — escalations exist; this feature fixes disposition UX, does not remove the gate.
- **F647** — criteria attestation gate; this feature surfaces it as a named blocker earlier (AutoConductor wait already landed separately).
- **F644** — post-merge gate; blocker shows gate command + log path from `lastCloseFailure`.
- **F428** — close-log panel; coupled headline during in-flight close.
- **F432** — close recovery; blocker kind `close-recovery` until cleared.

## Out of Scope

- Removing or making optional the close gates themselves (separate config feature if desired: `featureClose.escalationMode: warn`, `postMergeGate: false`).
- Research-close escalation parity (research has its own operator decision step).
- Merging close-log panel with terminal panel.
- New `currentSpecState` for "blocked on escalation" — stay data-driven via `openEscalations[]` per F646 decision.
- Fleet eval pick-winner UX beyond naming it as a blocker when applicable.

## Open Questions

Both questions have a stated default — if unanswered at start, implement the default; do not block.

- Should **Acknowledge & proceed** require a one-line reason modal on dashboard (CLI already requires `--reason`)? **Default: yes** — always show the modal for audit parity. The conditional skip (`escalation.category === 'ambiguous'` + reviewer approved) is deferred; do not build the skip path in v1.
- Should autonomous mode auto-disposition `ambiguous` escalations when reviewer ran `--approve`? **Default: no** — operator trust is the point of F646; copy fix only unless operator feedback says otherwise.

## Related

- Research: none
- Prior work: F650 (card hierarchy — incomplete for close), F646/F647/F644 (gates that created the stack), F428 (close log), F432 (recovery), F654/F656 (operator pain, 2026-07-09)
- Operator feedback: close gates stack + escalation disposition opaque; "rendered aigon almost unusable" (2026-07-09)
