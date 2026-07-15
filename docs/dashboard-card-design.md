# Dashboard card design (F650)

Internal maintainer guidance for editing feature/research dashboard cards. **Target-repo agents never edit these renderers** — this doc lives in the aigon repo only (`docs/`, not `templates/docs/`).

Visual reference: [`card-design-wireframe.html`](./card-design-wireframe.html)  
Headline precedence (server): `lib/card-headline.js`  
Presentation model (server): `lib/card-presentation.js`  
Pipeline render: `templates/dashboard/js/pipeline.js` + `card-presentation.js`  
Contract preview render (F679, `dashboard.contractCards` default off): `templates/dashboard/js/contract-cards/` — consumes `uiContract` only; see `docs/feature-interaction-contract.md`

## Card hierarchy (top → bottom)

Every feature and research card renders in this order:

1. **Identity** — id, title, compact badges (set, lease, escalation, scheduled).
2. **Current state** — one dominant headline (`cardHeadline` + `cardPresentation.contextLine`). Answers: *what is happening now?*
3. **Progress / history** — quiet timeline (`cardPresentation.timeline`) for completed milestones and the failed step when applicable.
4. **Agent / session detail** — compact summary (`cardPresentation.agentSummary`) when the current state is a failure; full agent rows otherwise.
5. **Actions** — one primary button from `validActions`; secondary and overflow for the rest.

Do not stack multiple filled red panels or competing headline states on one card.

## One dominant state

- `lib/card-headline.js` picks a single headline via fixed precedence (failures → awaiting input → active work → ready).
- `lib/card-presentation.js` derives suppression flags so legacy panels do not repeat the headline (e.g. hide `kcard-close-failure` when headline is already `Close failed`).
- Never show `Ready to close` as a green success line when `lastCloseFailure` is set — use timeline entries (`Review approved` → `Close failed`).

## Color rules

| Severity | Use |
|----------|-----|
| **Red (`tone-warn`, `severity: error`)** | Single active blocker / failure only |
| **Green (`tone-running`, timeline complete)** | Running or completed milestones — quieter when a failure is active (`.kcard-timeline.is-quiet`) |
| **Amber (`tone-attention`, `tone-waiting`)** | Needs operator attention, not a hard failure |
| **Teal (`tone-ready`)** | Ready for next step (eval complete, implemented awaiting close) |

## Action priority

- **Eligibility** is server-owned (`validActions` from workflow rules). The frontend may sort and style only.
- At most **one primary** action in the main row (`renderActionButtons` in `actions.js`).
- When `cardPresentation.severity === 'error'`, recovery actions (`metadata.recovery` / `metadata.recoverySurface`) win primary slot.
- Session/debug controls (peek, Open Terminal, dev server) stay secondary or overflow unless the state is explicitly awaiting session input.

## State priority (headline)

1. Active failure — close failed, autonomous failed, spec drift, missing engine state, recovering close  
2. Awaiting operator input  
3. Active recovery / revision / review / evaluation  
4. Running implementation or research  
5. Ready for next operator action  
6. Completed / resting  

## Close readiness (F658)

Feature rows carry a server-owned `closeReadiness` DTO from `lib/close-readiness.js` (`buildCloseReadiness`), attached in `lib/dashboard-collect/feature-poll.js`. The dashboard frontend **must not** re-derive close blockers from raw `openEscalations`, `lastCloseFailure`, or autonomous plan handoff labels.

**Shape:** `{ applicable, ready, blockers[], primaryBlocker, phase, closeLogHint }` — each blocker has `{ kind, label, detail, actionKind?, actionCommand? }`.

**Blocker kinds:** `open-escalation`, `preauth-validation`, `post-merge-gate`, `merge-conflict`, `close-recovery`, `autonomous-stopped`, `eval-pick-winner`, `awaiting-input`, `dependency-blocked`, `close-gate` (unknown failure fallback).

**Headline precedence:** when `closeReadiness.applicable && primaryBlocker`, the headline shows `Blocked: …` **before** autonomous-plan handoff verbs (`Starting close`, etc.). While close is in flight (`phase === 'closing'`), headline is **Closing…**.

**Ready indicator:** `.kcard-ready-indicator` renders only when `closeReadiness.ready === true`. Never when blockers exist.

**Actions:** `primaryBlocker.actionKind` drives the sole primary button via `applyCloseReadinessActionPriority` (server) and `actions.js` (client partition).

Shared sync predicates live in `lib/close-gate-predicates.js` — imported by both `feature-close` enforcement and `buildCloseReadiness`.

## Examples

**Close failure after review**

```text
Close failed · 2h
Feature close failed after review approval.

Progress
✓ Review approved by CC
✓ Implemented by CU
✕ Close failed

[Recover] [⋯]
```

**Normal implementing**

```text
▶ Implementing · CU · 12m

(full agent row + actions)
```

## Tests

- `tests/unit/card-headline.test.js` — headline precedence  
- `tests/unit/card-presentation.test.js` — timeline + suppression flags  
- `npm run test:iterate` — mid-iteration gate (Playwright @smoke when dashboard paths change)

## Changing cards

1. Read this doc and the wireframe.  
2. Invoke `Skill(frontend-design)` before visual edits.  
3. Prefer extending `lib/card-presentation.js` over duplicating rules in `monitor.js` and `pipeline.js`.  
4. New `/api/status` fields that affect cards must be added to poll rows **and** `computeStatusFingerprint` if they are not already implied by existing fingerprint keys.
