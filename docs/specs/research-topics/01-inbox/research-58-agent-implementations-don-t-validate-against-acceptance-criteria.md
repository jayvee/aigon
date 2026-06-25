---
complexity: "medium"
origin: "customer-feedback"
reporter:
  name: ""
  identifier: ""
source:
  channel: ""
  reference: ""
feedback_refs:
  - "feedback:4"
  - "docs/specs/feedback/01-inbox/feedback-4-agent-implementations-don-t-validate-against-acceptance-criteria.md"
type: "bug"
---

# Research: Agent implementations don't validate against acceptance criteria

## Context

Feature 152 (pro-gated-reports) spec clearly stated that volume counts, cycle time, and "Features Completed" + "Commits" charts should remain free. The agent implementation gated ALL charts behind Pro, including the explicitly-free ones. The spec's acceptance criteria were specific and testable, but the agent did not validate its work against them before submitting. This is a systemic issue: agents complete implementations that look correct at a surface level but don't satisfy the actual acceptance criteria written in the spec. There's no automated or prompted self-check step.

## Evidence

- Feature 152 spec AC: "Reports > Summary tab: volume (completed today/7d/30d/90d, trend), cycle time (avg/median/max), and agent leaderboard remain free" - Actual implementation: `if (_proActive)` wrapped the entire Charts tab (line 879 of logs.js), gating ALL charts including Features Completed and Commits - Required manual fix after feature-close to correct the gating boundary

## Triage Notes

Pattern risk: this will recur on any feature with nuanced free/Pro boundaries or partial gating. The agent tends to take the simplest gating approach (wrap everything) rather than the specified granular approach.

## Questions to Answer

- [ ] What should we recommend based on this feedback?

## Scope

### In Scope
-

### Out of Scope
-

## Findings

## Recommendation

## Output
- [ ] Feature: