---
id: 4
title: "Agent implementations don't validate against acceptance criteria"
status: "inbox"
type: "bug"
reporter:
  name: ""
  identifier: ""
source:
  channel: ""
  reference: ""
---

## Summary

Feature 152 (pro-gated-reports) spec clearly stated that volume counts, cycle time, and "Features Completed" + "Commits" charts should remain free. The agent implementation gated ALL charts behind Pro, including the explicitly-free ones. The spec's acceptance criteria were specific and testable, but the agent did not validate its work against them before submitting.

This is a systemic issue: agents complete implementations that look correct at a surface level but don't satisfy the actual acceptance criteria written in the spec. There's no automated or prompted self-check step.

## Evidence

- Feature 152 spec AC: "Reports > Summary tab: volume (completed today/7d/30d/90d, trend), cycle time (avg/median/max), and agent leaderboard remain free"
- Actual implementation: `if (_proActive)` wrapped the entire Charts tab (line 879 of logs.js), gating ALL charts including Features Completed and Commits
- Required manual fix after feature-close to correct the gating boundary

## Triage Notes

Pattern risk: this will recur on any feature with nuanced free/Pro boundaries or partial gating. The agent tends to take the simplest gating approach (wrap everything) rather than the specified granular approach.

## Proposed Next Action

Promote to feature: add a validation step to the feature workflow where the agent must explicitly map each acceptance criterion to its implementation before submitting. Could be:
1. A prompt in the feature-submit template requiring AC checklist sign-off
2. An automated check that parses AC items and asks the agent to confirm each
3. A review step that diffs the spec AC against the implementation log
