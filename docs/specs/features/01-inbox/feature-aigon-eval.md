---
complexity: high
set: signal-health
---

# Feature: aigon-eval

## Summary

`aigon-eval` is the internal benchmark that answers the question *"can this model, with its size and capabilities, follow Aigon's instructions and complete the workloads we put through Aigon, most of the time?"* It runs a canned end-to-end lifecycle (create → start → do → close) for both feature and research workflows, against a candidate (agent, model) pair, and scores it on a fixed set of contract checks: did every expected lifecycle signal arrive on time? Did the agent stay inside scope? Did the final state match the expected end state? Pass/fail is binary per (agent, model) pair; multi-run reliability is the threshold for green-listing a model into production use.

This is an internal Aigon-developer tool, not a user-facing feature. The output decides which (agent, model) options the start-modal exposes by default and which carry a "hasn't passed `aigon-eval` yet" warning. Third feature in the `signal-health` set; consumes the telemetry from `signal-health-telemetry`.

## User Stories

- [ ] As the Aigon developer, when a new model ships (e.g. `gemini-3-flash-preview` becomes available), I want to run `aigon-eval --agent gg --model gemini-3-flash-preview` and get a pass/fail decision in under 10 minutes on a low-token canned workload, before I expose it to users.
- [ ] As the Aigon developer, I want to run `aigon-eval --all` overnight and wake up to a per-(agent, model) reliability matrix, so I can decide which combinations to keep on the green-list.
- [ ] As the Aigon developer, I want each eval run to record granular pass/fail per check (signalled implementing? signalled implementation-complete? wrote only its own findings? committed only the right files?), so when something fails I see *what* failed without trawling tmux output.
- [ ] As the Aigon developer, I want models that fail `aigon-eval` to be quarantinable in their agent JSON automatically (per `feedback_quarantine_bad_models.md`), without me having to remember to update config by hand.

## Acceptance Criteria

- [ ] New CLI: `aigon eval [--agent <id>] [--model <id>] [--workload <feature|research|both>] [--runs <N>] [--all] [--report]`. With `--all`, iterates the cartesian product of (active agents) × (modelOptions per agent, where `quarantined !== true`).
- [ ] Workloads are canned, deterministic, and lightweight: one feature workload (small CRUD-style change with three acceptance criteria, ~50 lines of expected diff) and one research workload (three questions, no codebase changes). Both designed to complete on a low-end model in under 5 minutes.
- [ ] Each run executes against a temporary worktree at `/tmp/aigon-eval-<agent>-<model>-<ts>/`, started from a fixed git ref so runs are reproducible. Worktree torn down on completion regardless of pass/fail.
- [ ] Per-run check matrix (each check is binary pass/fail, all must pass for the overall run to pass):
  - **Lifecycle signals fired**: `implementing` → final-complete arrived in correct order with no skipped or duplicate states.
  - **Signal latency within SLA**: each transition arrived within `aigonEval.slaSeconds` of the action that should trigger it.
  - **Scope discipline**: agent only modified files declared in scope (feature workload: only the file in spec's `## Acceptance Criteria`; research workload: only its own findings file).
  - **Forbidden command guard**: agent did not run `feature-close`, `research-close`, or other user-only commands from inside the session.
  - **Final state**: spec landed in the right folder; engine snapshot matches expected end state.
  - **No nudge required**: the run completed without `auto-nudge-with-visible-idle` having to fire (independent of whether nudges are enabled in production config). A nudge-required run is recorded but counts as a fail for green-list scoring.
- [ ] Pass/fail per (agent, model) is the conjunction of all checks across `--runs N` (default 3) consecutive runs. Two-of-three runs failing means quarantine.
- [ ] Output: `.aigon/benchmarks/aigon-eval/<agent>-<model>-<workload>-<ts>.json` per run; aggregated matrix in `.aigon/benchmarks/aigon-eval/matrix.json` consumed by the start-modal recommender.
- [ ] Optional `--report` flag renders the matrix as Markdown with green/red per cell, reliability percentage, and per-check failure counts. Suitable for paste into commit messages or release notes.
- [ ] When a (agent, model) pair fails ≥ 2 of 3 runs, it gets `quarantined: true` written to `templates/agents/<id>.json` `modelOptions[…]` automatically with a `quarantineReason: "aigon-eval failure: <check>"` annotation. Per `feedback_quarantine_bad_models.md`, never delete entries — only mark them.
- [ ] Re-running `aigon eval` against a quarantined entry clears the quarantine if the new runs pass (auto-recovery on model fix).
- [ ] Running `aigon-eval` consumes `signal-health-telemetry` events to verify signal latency — single source of truth, not a parallel measurement.
- [ ] Integration test: a mock agent that emits all expected signals passes; a mock agent that skips `implementation-complete` fails the lifecycle check; a mock agent that runs `feature-close` from inside the session fails the forbidden-command check.

## Validation

```bash
node --check lib/commands/aigon-eval.js
node --check lib/aigon-eval-runner.js
node --check lib/aigon-eval-checks.js
npm test -- --testPathPattern='aigon-eval'
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets.
- May write `quarantined: true` to `templates/agents/<id>.json` from `aigon-eval` runs as the explicit purpose of this feature.
- May add new fixture files under `templates/aigon-eval/` (feature workload spec, research workload spec, expected diffs) without going through the normal `feature-create` flow — fixtures are not features.

## Technical Approach

### Three pieces

1. **Workload fixtures** — `templates/aigon-eval/workloads/{feature,research}/` containing a canned spec and an "expected outcome" sidecar (allowed-files, expected lifecycle signals, expected final state).
2. **Runner** (`lib/aigon-eval-runner.js`) — sets up a temp worktree, launches the agent through the same `lib/worktree.js` path production uses, watches `signal-health-telemetry` events, terminates after success / SLA breach / hard timeout, scores against checks, tears down.
3. **Check library** (`lib/aigon-eval-checks.js`) — pure functions, one per check, each takes `(workloadFixture, telemetryEvents, finalEngineSnapshot, gitDiff)` and returns `{ pass: bool, reason: string }`.

### Why use the production launch path

Per `feedback_validate_with_real_tools_first.md`, the eval has to test the actual code paths a user would hit. Running through `lib/worktree.js` `buildAgentLaunchCommand` means a regression in the launch path (the same kind of thing that broke r45/r46) gets caught by `aigon-eval` automatically. Synthetic launch paths would defeat the purpose.

### Why workload fixtures, not real specs

Real specs in this repo are too big and too dependent on prior context to be deterministic eval inputs. A canned 50-line feature with three acceptance criteria is small enough to run in 5 minutes, deterministic enough to compare runs, and representative enough to exercise the full lifecycle. Both workloads sized to fit cheap models (Haiku, Flash, Mini).

### Cost discipline

Default `--workload feature` and `--workload research` together total an estimated ≤ 50k tokens per run on a low-end model. `--runs 3` × `--all` across 4 agents × 5 models = 60 runs ≈ 3M tokens ≈ < $5 with cheap models. The cost ceiling matters because the user explicitly framed this as something they run repeatedly to qualify new models; if it costs $50 per run nobody runs it.

### What "follows Aigon's instructions" actually decomposes to

The check list above is the operational definition. If we add new lifecycle invariants over time (new agent-status signals, new scope rules), they go in the check library. The bench grows with the contract.

### What's NOT in the bench (deliberately)

- Code quality. The eval doesn't grade the agent's diff; it only checks that the diff is in-scope and the lifecycle was followed. Code quality is what `feature-eval` and human review do — different question.
- Latency benchmarking. We capture turn count and total tokens for context, but pass/fail is on contract-following, not speed. A slow but correct agent passes.
- Cost benchmarking. Same — captured but not gated on.

### Green-list integration

The start-modal already reads `templates/agents/<id>.json modelOptions`. Add a `lastAigonEvalAt` and `aigonEvalReliability` annotation per entry; the start-modal renders a "✓ green-listed" badge when reliability ≥ 90% over recent runs and a "⚠ unverified" badge for entries that haven't been eval'd or haven't passed. No hard gate — the operator can still pick an unverified model knowingly.

### Why this lands last in the set

It needs `signal-health-telemetry` to exist (events to assert against) and benefits from `auto-nudge-with-visible-idle` existing (so the "no nudge required" check is meaningful — without it, nudge tracking has nowhere to record). Building the eval first would mean asserting against telemetry that doesn't exist yet.

## Dependencies

depends_on: signal-health-telemetry, auto-nudge-with-visible-idle

Soft dependency (recommended, not blocking): `agent-quota-awareness` — when present, the eval runner pre-checks `.aigon/state/quota.json` and skips depleted (agent, model) pairs with a `quota-skipped` outcome rather than burning a run on a doomed start. When absent, the eval runs against every (agent, model) pair regardless and any quota cap mid-run is classified via `feature-handle-quota-failure`'s `quota-paused` event (also a soft dep — both are infrastructure that improves eval signal quality without being required for a first-cut implementation).

## Out of Scope

- A model leaderboard published to docs/marketing. The matrix is internal; surfacing it externally is a marketing decision, not an engineering one.
- Continuous integration of `aigon-eval` (running it on every PR). Could be a follow-up; first ship the manual-run version.
- Cross-installation aggregation of eval results. Per-installation only.
- Evaluating models we don't currently have in `modelOptions` — the bench tests configured models, not arbitrary ones.
- Replacing the existing `perf-bench` (different question: how fast is this agent on real specs in this repo).

## Open Questions

- Where does the canned workload's "expected files" list live — alongside the workload spec, or in a separate sidecar? Probably sidecar so it's machine-readable without parsing the markdown.
- Should the bench also exercise `feature-spec-review` and `feature-code-review` lifecycles, or only `feature-do` and `research-do` for the first version? Argument for narrow first cut: those two are the most common stall points.
- How do we handle agents that have legitimate flake (network blips on `aigon agent-status` writes)? Probably retry-once on a single failed run before marking the (agent, model) pair as failed. Need to avoid masking real flake.
- The user wanted *"can the model... most of the time"* — does the spec's three-of-three pass requirement match that? Maybe relax to two-of-three for green-list, keep three-of-three for "promoted to default". Calibrate after first runs.

## Related

- Set: signal-health
- Prior features in set: signal-health-telemetry, auto-nudge-with-visible-idle
- Cross-set soft deps: feature-agent-quota-awareness (skip pre-known-depleted pairs); feature-handle-quota-failure (classify mid-run quota events as `quota-skipped`, not as model failures).
- The existing `perf-bench` answers a different question (speed on real specs); `aigon-eval` answers contract-following on canned workloads.
