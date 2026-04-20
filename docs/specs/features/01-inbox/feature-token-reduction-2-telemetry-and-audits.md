# Feature: token-reduction-2-telemetry-and-audits

## Summary
Close the measurement gap that blocks data-driven token-reduction work. Extend the cc / cx / gg parsers in `lib/telemetry.js` to emit per-turn token counts and a `contextLoadTokens` bucket (first-N turns rolled up separately), link implement / review / eval / close sessions under a shared workflow-run id so end-to-end cost per feature becomes queryable, and audit whether `~/.codex/config.toml` is actually serialised into Codex's model prompt context (the 2069-line file is the open question that gates any pruning work there). Research 35 found existing telemetry is dominated by `implement` sessions and gives no per-turn or per-activity breakdown, so claims like "eval/review is cheap" or "Fleet costs 3×" cannot be grounded today.

## User Stories
- [ ] As a maintainer evaluating whether the slim-context work actually saved tokens, I can compare per-turn `contextLoadTokens` before and after and see the delta per agent.
- [ ] As a maintainer deciding whether to prune `~/.codex/config.toml`, I have evidence for whether its contents reach the model prompt or only the local CLI.
- [ ] As a user reviewing a feature's total cost, I see implement + review + eval + close combined under one workflow-run id in `stats.json`.

## Acceptance Criteria
- [ ] `lib/telemetry.js` parsers (`parseCodexTranscripts`, `parseGeminiSessionFile`, and the cc parser) emit a `turns[]` array on each session record with at least `{ index, inputTokens, outputTokens, cachedInputTokens }` per turn.
- [ ] Session records expose a `contextLoadTokens` rollup (sum of the first N turns, N configurable with a safe default) alongside existing totals.
- [ ] `.aigon/workflows/features/{id}/stats.json` links all sessions that belong to the same feature run (implement, review, eval, close) under a shared `workflowRunId`.
- [ ] An `aigon stats` subcommand (or equivalent doctor output) prints per-activity totals — at minimum one line per activity kind (implement / review / eval / close) — for a selected feature id.
- [ ] The Codex config audit is committed as a short `docs/` note recording: the method used (e.g. local inspection of Codex CLI behaviour, upstream docs, or a controlled experiment), the conclusion (sent as prompt / local-only / unproven), and a recommendation for whether `install-agent cx` should keep writing 679 project trust entries to a shared file.
- [ ] A test pins the new `turns[]` / `contextLoadTokens` shape against a recorded transcript fixture for at least one agent.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
Extend the three parsers with per-turn emission; keep the existing totals intact so older consumers don't break. Thread the shared workflow-run id through the launch sites (implement/review/eval/close) — the engine already has a feature id, so the simplest shape is `workflowRunId = <featureId>-<startedAt>` captured once at launch and passed via env var or state file so every spawned session stamps it. For the config-audit deliverable, do not attempt a vendor-side inspection that cannot be verified; a one-page `docs/notes/` write-up with the method, evidence, and confidence level is enough to unblock the decision.

## Dependencies
-

## Out of Scope
- Pruning `~/.codex/config.toml` itself — that is a follow-up gated on this feature's audit result.
- A full cost dashboard UI. Surface the numbers through `aigon stats` / `stats.json`; UI comes later if value is proven.
- Cross-feature cost comparison or trend reporting.

## Open Questions
- Is `workflowRunId` better stored in the engine event log as a field on the session-start event, or kept out-of-band in `.aigon/state/`? Decide during implementation based on which path already has the launch metadata.
- What is the right default for N in `contextLoadTokens`? Start with 3 and revisit once the first real comparison runs.

## Related
- Research: #35 token-and-context-reduction
