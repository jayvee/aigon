---
complexity: medium
research: 26
set: reduce-tokens
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-08T02:26:25.814Z", actor: "cli/feature-prioritise" }
---

# Feature: reduce-tokens-4-output-compression

## Summary

Pilot opt-in adapters for two external tool-output compression systems — **RTK** (Rust Token Killer, Apache-2.0; intercepts `Bash` calls and deterministically compresses noisy CLI output: `git`, `pytest`, `kubectl`, `npm`) and **context-mode** (Elastic 2.0; sandboxes large tool outputs into a SQLite/FTS5 index and returns intent-ranked snippets, plus a PreCompact state-snapshot pattern). Both research agents agreed these are the most credible external systems but warned against vendoring wholesale (license, state-overlap, surprise-rewrite failure modes). Ship them as opt-in adapters with allowlisted command categories, raw-output recovery escape hatches, and before/after telemetry comparison powered by feature 1.

## User Stories
- [ ] As a maintainer, I can enable the RTK adapter for shell-heavy commands (tests, `git status`, log dumps) via a config flag and see compressed output reach the agent.
- [ ] As a maintainer, I can recover the raw uncompressed output of any compressed command for debugging.
- [ ] As a maintainer, the cost dashboard shows per-command savings (RTK's `rtk gain` data, context-mode's `stats` data) and no regression in agent task quality on a smoke benchmark.
- [ ] As a maintainer, I can disable either adapter without leaving stale config or hooks.

## Acceptance Criteria
- [ ] `tool_output_compression: rtk | context-mode | none` config knob in `.aigon/config.json`; default = `none`.
- [ ] RTK adapter installed via documented `.claude/settings.json` snippet that hooks `PreToolUse` for `Bash`. Allowlist of commands documented; rest pass through untouched.
- [ ] context-mode adapter installs as an MCP server with documented opt-in. License (Elastic 2.0) called out explicitly in the adapter docs — fine for personal/team use, gates on bundling into managed offerings.
- [ ] Raw-output recovery: any compressed command result is also archived to `.aigon/telemetry/raw-output/{session}/{tool-call}.txt` so the user can re-read the original.
- [ ] Token-cost dashboard (feature 1) gains a "compression" column showing per-session savings attributed to whichever adapter is active.
- [ ] Smoke benchmark: a small fixture suite (3-5 representative tasks) runs with and without compression; agent must still produce equivalent diffs / decisions. Documented quality threshold (e.g. equivalent task success rate within ±5%).

## Technical Approach

Adapters, not vendoring. RTK lives outside the repo; we ship a tested settings snippet plus a thin shim that records `rtk gain` deltas into the telemetry stream. context-mode runs as a separate MCP server; we ship an MCP config + a documented start command. Neither tool gets bundled.

Allowlist categories per cx's findings: tests, `git status`, `git diff`, `rg`, `find`, `ls`, log dumps. Specs, code review evidence, security scan output stay raw — both research agents flagged these as opt-in-only surfaces because dropped tokens may be exactly the acceptance criterion that matters.

The smoke benchmark should reuse `lib/perf-bench.js` patterns where possible. Use feature 1's telemetry for the before/after comparison so the dashboard becomes the canonical place to evaluate this pilot.

## Dependencies
- depends_on: reduce-tokens-1-cost-dashboard

## Out of Scope
- Caveman-style lossy rewriting of agent output (rejected by both research agents — corrupts document-driven workflow).
- LLMLingua / Selective Context model-based compression (deferred — too heavy for the launch path).
- Bundling either tool into Aigon's release artifacts. Opt-in adapters only.
- Replacing built-in `Read` / `Grep` / `Glob` tools — RTK only intercepts `Bash`, and context-mode is opt-in routing.

## Open Questions
- If both adapters prove valuable, should they compose (RTK for shell, context-mode for large structured output)? Defer until single-adapter wins are confirmed.
- Should the smoke benchmark gate enabling the adapter (CI fail → can't enable) or just inform? Recommend: inform-only initially, gate later.

## Related
- Research: #26 reduce-token-usage
- Set: reduce-tokens
- Prior features in set: reduce-tokens-1-cost-dashboard
