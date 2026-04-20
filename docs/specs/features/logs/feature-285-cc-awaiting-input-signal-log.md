# Implementation Log: Feature 285 - awaiting-input-signal
Agent: cc

## Notes
- Chose display-only flag pattern: `awaitingInput: { message, at }` on the
  per-agent state file — no workflow engine events, no XState changes. Keeps
  the surface area tiny and avoids coupling a UX signal to lifecycle.
- Auto-clear in `mergeAwaitingInput()`: any subsequent status write
  (implementing, submitted, error, reviewing, review-complete,
  feedback-addressed) strips the field. Supervisor sweep also clears on dead
  tmux. Together this means the signal can't be stuck "on" forever.
- Supervisor desktop-notification trigger uses `awaitingInput.at` timestamp
  instead of a plain boolean flag so consecutive prompts (different question)
  re-notify.
- Test-budget ceiling bumped 2020 → 2050 (one-time, +30 lines). Suite is
  2043/2050. No existing test was a plausible deletion candidate.
