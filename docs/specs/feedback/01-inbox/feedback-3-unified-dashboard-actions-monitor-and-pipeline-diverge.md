---
id: 3
title: "Unified dashboard actions — Monitor and Pipeline diverge"
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

Monitor and Pipeline views show entirely different actions for the same feature in the same state. This makes the dashboard confusing and unpredictable — the user doesn't know which view to trust or which action to take.

**5 specific issues found during manual fleet testing (2026-03-19):**

### 1. Monitor close doesn't pass winning agent
Monitor's "Continue" dropdown runs `feature-close 02` without the agent argument. Fleet close requires specifying the winner (`feature-close 02 cc`). Result: "Branch not found: feature-02-brewery-import. Multiple worktrees found."

### 2. Pipeline shows "Continue Evaluation" as primary when eval is done
When `evalStatus === 'pick winner'` and `winnerAgent === 'cc'`, the primary button should be "Accept & Close" (or "Close & Merge cc"). Instead, "Continue Evaluation" is the prominent button and "Accept & Close" is greyed out/secondary.

### 3. Pipeline "Accept & Close" appears disabled
The button exists but looks greyed out. Clicking it does show the winner picker modal, so it's not actually disabled — just visually misleading.

### 4. No adoption option anywhere
Neither Monitor nor Pipeline offers "Close + Adopt from [agent]" or "Close + Adopt all". The eval document may recommend cross-pollination but there's no way to act on it from the dashboard. (Related to feedback-2)

### 5. Monitor and Pipeline render completely different action sets
For the same feature in `in-evaluation` with `pick winner`:
- **Monitor**: "Continue" button with dropdown containing "Accept & Close"
- **Pipeline**: "Accept & Close" (greyed) + "Continue Evaluation" (primary) + "View Eval"

These should show the **exact same actions** since they're the same feature in the same state. The state machine computes `validActions` for each feature — both views should render from that same list.

## Evidence

Observed during manual fleet testing on brewboard #02 brewery-import (2026-03-19):
- Both agents submitted, eval completed by cc, recommended cc as winner
- Monitor showed "Continue" → dropdown → "Accept & Close" which failed (no agent arg)
- Pipeline showed "Continue Evaluation" primary, "Accept & Close" greyed out
- Pipeline "Accept & Close" opened winner picker, which worked but then ran `feature-close 02` without the picked agent

## Triage Notes

- Type: feature-request (architectural — needs unified action rendering)
- Priority: high — this is the core dashboard UX for the fleet workflow
- Root cause: Monitor (monitor.js) and Pipeline (pipeline.js) each have their own action-rendering logic instead of sharing a single `renderActionsForFeature(feature, validActions)` function
- The state machine already computes `validActions` correctly — the problem is purely in the two view layers interpreting them differently

## Proposed Next Action

Create feature: **unified-dashboard-actions**

Scope:
1. **Single action renderer** — both Monitor and Pipeline call the same function to render buttons for a feature card. Actions come from `validActions` in the `/api/status` response.
2. **Fleet close passes agent** — the winner picker modal must pass the selected agent to the close action. If eval picked a winner, pre-select it.
3. **Eval-done state** — when `evalStatus === 'pick winner'`, primary action is "Close & Merge [winner]", secondary is "Continue Evaluation".
4. **Adoption option** — close modal offers "Close", "Close + Adopt from [agents]", "Close + Adopt all" when fleet has multiple agents.
5. **Log writing before commit** — move log step before code commit in feature-do template so agents can't skip it.
