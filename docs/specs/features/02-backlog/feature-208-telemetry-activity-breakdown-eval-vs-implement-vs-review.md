# Feature: Telemetry Activity Breakdown (eval vs implement vs review)

## Summary

Add an `activity` field to normalized telemetry records so cost/token data can be broken down by what the agent was doing — implementing, evaluating, or reviewing. This would let users see "CC spent $1.95 evaluating" vs "GG spent $0.02 implementing" in the Stats tab.

## Problem

Currently telemetry records only have `agent` and `model`. For fleet features, the evaluator (cc) is indistinguishable from an implementer at the data level. Users can't answer "how much did evaluation cost vs implementation?"

## Acceptance Criteria

- [ ] `writeNormalizedTelemetryRecord` accepts an optional `activity` field: `'implement' | 'evaluate' | 'review'`
- [ ] `captureSessionTelemetry` (CC SessionEnd hook) infers activity from branch name: `feature-{id}-{agent}` = implement, eval branch = evaluate, review branch = review. Falls back to `'implement'` if unclear.
- [ ] `captureAgentTelemetry` passes `activity: 'implement'` (always — this is called at feature-close for implementers)
- [ ] `collectCost` aggregates `byAgent` with an `activity` field per agent record
- [ ] Stats tab renders activity next to the agent name: e.g. `CC · claude-opus-4-6 · implement · 27+3,536 tok · $1.9577`

## Technical Approach

1. Add `activity` to the telemetry record schema (optional, defaults to `'implement'`)
2. In `capture-session-telemetry` (misc.js): parse `AIGON_PROJECT_PATH` + current branch from the transcript path to infer activity
3. In `captureAgentTelemetry`: pass `activity: 'implement'` when writing records
4. In `collectCost`: include `activity` in `byAgent[agentId]`
5. Dashboard render: show activity label in per-agent row

## Out of Scope

- Retroactive backfill of existing records
- Sub-activity breakdown (e.g. which phase of eval)
