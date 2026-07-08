---
complexity: medium
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
- [ ] `confirmDelivery` (`lib/agent-sessions/hosts/tmux.js`) confirms a paste even when the message is reflowed across composer lines / wrapped in box borders — i.e. it no longer requires a verbatim contiguous substring match.
- [ ] `submitMessage` sends the submit key even when confirmation is *uncertain*; delivery must not throw before the submit keystroke is attempted. Failure to confirm the paste degrades to "submit anyway", not "abort without pressing Enter".
- [ ] `promptStillContainsMessage` / `extractLastPromptLine` submit-success detection no longer assumes the full message appears on one `›`-prefixed line; the heuristic tolerates wrapped/bordered Codex composer rendering (whitespace/border-normalized comparison, or a distinctive-token match rather than the full string).
- [ ] Unit test covers a realistic Codex bordered-composer `capture-pane` fixture (long message wrapped across ≥2 lines) and asserts (a) confirmation succeeds and (b) the submit key is sent. This path is currently untested — no test references `promptStillContainsMessage`, `extractLastPromptLine`, or `deliverOperatorMessage`'s confirm/submit branches.
- [ ] The existing paste-buffer path for cc/cu (single-line prompts) still works — no regression.

## Validation
```bash
npm run test:iterate
```

## Pre-authorised

## Technical Approach
- Delivery lives in `lib/agent-sessions/hosts/tmux.js` `deliverOperatorMessage` (paste-buffer branch, ~L342): `loadBuffer` → `pasteBuffer` → `confirmDelivery` (L291) → `submitMessage` (L303). cx has no `useSendKeys`, so it takes this branch; `nudgeTransport` for cx is `{ submitKey: Enter, submitAttempts: 2, retryDelayMs: 700 }` with no `successPatterns`/`promptPlaceholder`.
- Normalize both the captured pane and the message before comparison: strip box-drawing/border chars, collapse runs of whitespace/newlines to single spaces, then substring-match. Apply the same normalization in `confirmDelivery`, `promptStillContainsMessage`, and `extractLastPromptLine`.
- Change the failure posture: an unconfirmed paste should **still attempt submit** (best-effort) rather than throwing before `submitMessage`. The nudge error contract (throw with `.paneTail`) can be preserved for genuine delivery failures, but "couldn't string-match the echo" must not block the Enter keystroke.
- Consider a shorter, wrap-resistant auto-nudge message, or matching on a distinctive leading token, as a defense-in-depth complement (not a substitute) for the normalization fix.
- Note for the implementer: a **second, separate** failure mode appeared in the same telemetry — `Cannot find module '../../worktree'` thrown from stale worktree preview servers (`.aigon/worktrees/aigon/feature-640…`, `…-642…`) running pre-F632 code. That require was removed by F632 (`bf5b19d06`, 2026-07-08 12:04) and is **out of scope here** (fixed in code; needs process restart, not a code change).

## Dependencies
-

## Out of Scope
- The `Cannot find module '../../worktree'` crash (already fixed by F632; resolved by restarting stale server/worktree processes).
- Preventing worktree `--preview` servers from auto-nudging the primary checkout's sessions (separate concern; CLAUDE.md rule #4 already warns of the collision).
- Changing the auto-nudge idle ladder timings/escalation logic in `lib/auto-nudge.js`.

## Open Questions
- Should an unconfirmed-but-submitted nudge record `operator.nudge_sent` normally, or a distinct "delivered-unconfirmed" marker for observability?

## Related
- Prior work: F554 (`4af1287d5`) introduced the tmux SessionHost delivery path; F632 (`bf5b19d06`) split `worktree.js` and removed the `../../worktree` require.
