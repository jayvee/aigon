# Feature: token-reduction-3-autopilot-context-carry-forward

## Summary
Stop paying the full cold-start context cost on every Autopilot iteration. Today `lib/validation.js` spawns a fresh agent CLI for each iteration of the `--iterate` loop, so every retry repays `AGENTS.md` + `CLAUDE.md` + the command template + the inlined spec, with no memory of what the previous iteration already tried. This feature introduces a distilled carry-forward: a short, bounded summary of "what was attempted and what failed last iteration" gets injected into the next iteration's prompt in place of the cold-start preamble when safe. Research 35 flagged this as the clearest orchestration-level amplifier of prompt cost and called out that the polling loop itself is free — the expense is session restarts.

## User Stories
- [ ] As an operator running an Autopilot loop that takes many iterations to converge, the tokens spent re-loading orientation docs drop sharply after iteration 1.
- [ ] As an agent picking up iteration N+1, I see a short summary of what iteration N tried and why it failed, without needing to re-read the full feature log.

## Acceptance Criteria
- [ ] Iterations 2+ of `runRalphCommand` (or its successor) consume materially less context than iteration 1 — target: at least a 50% reduction in first-turn input tokens on iterations 2+ versus iteration 1, measured against a representative feature.
- [ ] The distilled carry-forward summary is bounded (hard cap in characters or tokens) and is generated deterministically from the previous iteration's output (e.g. last test-failure lines, last commit message, last error) — no additional model call just to produce the summary.
- [ ] When no previous iteration output exists (iteration 1), behaviour is unchanged.
- [ ] A test pins the summary-generation logic against a fixture iteration transcript.
- [ ] Safety: if the carry-forward path fails or yields nothing useful, the loop falls back to the current cold-start behaviour — a broken summary must not block the iterate loop.

## Validation
```bash
node -c aigon-cli.js
node -c lib/validation.js
npm test
```

## Technical Approach
Edit `lib/validation.js` where the iterate loop currently spawns each iteration. Read the previous iteration's artefacts (feature log tail, last test output, last diff) and produce a bounded plain-text summary. Inject it via a flag on the launch prompt — not via a new template — so the always-on template mass stays the same and we only add a per-iteration "Previous attempt" block. Do not introduce an LLM call to generate the summary; deterministic text extraction is enough and avoids a new cost source. The first-turn-input-token measurement depends on telemetry from `token-reduction-2-telemetry-and-audits`, but this feature is not blocked on it — we can ship the behaviour and measure after.

## Dependencies
-

## Out of Scope
- Changing the polling cadence of `__run-loop` — it already uses `sleep`, which is free.
- Shared system prompt across Fleet worktrees — that would change Fleet semantics; out of research scope.
- Any work that would change what the *first* iteration loads — handled in `token-reduction-1-slim-always-on-context`.

## Open Questions
- Exactly which artefacts form the best deterministic summary: test output tail, last commit message, last diff summary, or a concat? Pick based on whichever the agent most commonly needs next iteration.
- Should the carry-forward replace the standard template preamble entirely on iterations 2+, or always be additive? Default: additive (lower risk of skipping a now-relevant safety rule).

## Related
- Research: #35 token-and-context-reduction
