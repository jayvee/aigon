---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-08T22:04:17.250Z", actor: "cli/feature-prioritise" }
---

# Feature: nudge-confirm-robust-codex-wrap

## Summary
Operator/auto nudges silently fail to submit into the Codex (cx) TUI: the message text lands in the composer but Enter is never pressed, so the agent stays idle until the auto-nudge ladder escalates to `needs-attention`. Root cause is in the tmux SessionHost delivery path — `confirmDelivery` (and the sibling `promptStillContainsMessage` submit-success heuristic) assume the nudge message survives in `capture-pane` output as a **verbatim, contiguous substring on a single line**. Codex reflows a long single-line message across its bordered composer, so `paneTail.includes(message)` returns false. Delivery **throws before `submitMessage` is ever called** — paste succeeded, Enter never happened. This feature makes nudge confirmation robust to wrapping/border reflow so the submit keystroke actually fires.

## Evidence (this incident)
- Session: `aigon-f633-review-cx-be-arch-5-collector-decomposition` (cx review role).
- Telemetry `.aigon/telemetry/signal-health/2026-07-08.jsonl` for entity 633 shows the auto-nudge firing every ~30s and every dispatch failing with `Nudge text not found in pane after delivery`, then escalating with `auto-nudge-escalated / idle-threshold-reached`. Same pattern earlier on f630/f631/f632.
- No `operator.nudge_sent` event in `.aigon/workflows/features/633/events.jsonl` — confirming delivery never completed.
- Reproduced: a long nudge message rendered inside Codex's bordered composer fails both `paneTail.includes(message)` (confirmDelivery) and `promptStillContainsMessage` (submit heuristic).

## User Stories
- [ ] As an operator, when I nudge a Codex review/impl session, the message is submitted (Enter pressed), not left sitting in the composer.
- [ ] As the autonomous controller, when auto-nudge fires against a Codex session, the agent actually resumes instead of the nudge silently failing and escalating to `needs-attention`.

## Acceptance Criteria
- [ ] `confirmDelivery` (`lib/agent-sessions/hosts/tmux.js`) confirms a paste when Codex reflows the message across composer lines and box borders; it must not depend on `paneTail.includes(message)` or any other verbatim contiguous full-message match.
- [ ] `deliverOperatorMessage` always attempts `submitMessage` after a paste-buffer delivery attempt for Codex/cx, even when paste echo confirmation is uncertain. The observable order is paste → best-effort confirmation → submit key, not paste → failed string match → throw before Enter.
- [ ] `promptStillContainsMessage` / `extractLastPromptLine` submit-success detection tolerates wrapped or bordered Codex composer rendering by comparing a normalized prompt/message form or a deterministic distinctive-token subset; it must not require the full message on one `›`-prefixed line.
- [ ] If the paste echo cannot be confirmed after submit attempts, the existing error contract is preserved for callers: failures still include enough pane context (`paneTail` or equivalent) for telemetry/debugging, but only after the submit key has been attempted.
- [ ] Unit coverage includes a realistic Codex bordered-composer `capture-pane` fixture with a long message wrapped across at least 2 visual lines, and asserts that confirmation succeeds and the configured submit key is sent. This path is currently untested; add direct coverage for the confirm/submit branches around `deliverOperatorMessage`, `promptStillContainsMessage`, and `extractLastPromptLine`.
- [ ] Regression coverage keeps the existing paste-buffer behavior for cc/cu-style single-line prompts working, including confirmation and submit-key dispatch.

## Validation
```bash
npm run test:iterate
node -c lib/agent-sessions/hosts/tmux.js
```

## Pre-authorised
- Keep the fix inside `lib/agent-sessions/hosts/tmux.js` unless tests require exposing helpers from that module. Do not move nudge policy into `lib/nudge.js`, `lib/auto-nudge.js`, or dashboard code.
- It is acceptable to add small pure helper functions for pane/message normalization if they are used by both paste confirmation and submit-success detection.
- It is acceptable to adjust tests or fixtures around the tmux host delivery path; do not introduce live tmux integration requirements for this regression.

## Technical Approach
- Delivery lives in `lib/agent-sessions/hosts/tmux.js` `deliverOperatorMessage` (paste-buffer branch, ~L342): `loadBuffer` → `pasteBuffer` → `confirmDelivery` (L291) → `submitMessage` (L303). cx has no `useSendKeys`, so it takes this branch; `nudgeTransport` for cx is `{ submitKey: Enter, submitAttempts: 2, retryDelayMs: 700 }` with no `successPatterns`/`promptPlaceholder`.
- Normalize both the captured pane and the message before comparison: strip box-drawing/border characters, remove prompt/border chrome, collapse runs of whitespace/newlines to single spaces, then compare. Apply the same normalization in `confirmDelivery`, `promptStillContainsMessage`, and any prompt-line extraction that feeds them so the fix has one comparison model.
- Change the failure posture in `deliverOperatorMessage`: capture whether paste confirmation was certain, still call `submitMessage`, then decide whether to return success or throw based on the post-submit result. A failed echo match must not be treated as proof that the paste did not happen before Enter is pressed.
- If using distinctive-token matching, make the token deterministic from the actual message and long enough to avoid matching generic prompt text; do not rely on random IDs or message mutation for this feature.
- Shortening the auto-nudge message is allowed only as defense in depth. It is not sufficient for acceptance because manual operator nudges and future long messages must also submit.
- Note for the implementer: a **second, separate** failure mode appeared in the same telemetry — `Cannot find module '../../worktree'` thrown from stale worktree preview servers (`.aigon/worktrees/aigon/feature-640…`, `…-642…`) running pre-F632 code. That require was removed by F632 (`bf5b19d06`, 2026-07-08 12:04) and is **out of scope here** (fixed in code; needs process restart, not a code change).

## Dependencies
- Existing agent registry `nudgeTransport` settings for cx; this feature should consume those settings, not special-case agent IDs outside registry-owned configuration.
- Existing signal-health telemetry and `operator.nudge_sent` workflow event semantics; the implementation should preserve current caller-visible behavior except for the corrected submit attempt.

## Out of Scope
- The `Cannot find module '../../worktree'` crash (already fixed by F632; resolved by restarting stale server/worktree processes).
- Preventing worktree `--preview` servers from auto-nudging the primary checkout's sessions (separate concern; CLAUDE.md rule #4 already warns of the collision).
- Changing the auto-nudge idle ladder timings/escalation logic in `lib/auto-nudge.js`.

## Open Questions
- Should an unconfirmed-but-submitted nudge record `operator.nudge_sent` normally, or a distinct "delivered-unconfirmed" marker for observability? Default to preserving today's event semantics unless implementation finds the distinction is needed for debugging.

## Related
- Prior work: F554 (`4af1287d5`) introduced the tmux SessionHost delivery path; F632 (`bf5b19d06`) split `worktree.js` and removed the `../../worktree` require.
