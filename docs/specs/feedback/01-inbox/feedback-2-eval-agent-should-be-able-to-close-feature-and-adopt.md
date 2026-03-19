---
id: 2
title: "Eval agent should be able to close feature and adopt"
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

Two UX gaps in the eval→close flow:

**1. Eval agent can't close:** The eval agent runs in the main repo, recommends a winner, and asks "which implementation to merge?" — but when the user responds, the agent can't run `feature-close` because `disable-model-invocation` blocks it. The user must leave the eval session, go to the dashboard or another terminal, and run close from there. This breaks the natural conversation flow.

**2. Dashboard close has no adoption option:** When closing from the dashboard Pipeline card (winner picker), there's no option to adopt improvements from the losing agent. The eval document may recommend cross-pollination (e.g. "gg's FOUC prevention is worth adopting") but the dashboard only offers simple "Close & Merge" — no "Close + Adopt" or "Close + Adopt all".

## Evidence

Observed during manual fleet testing on brewboard #01 dark-mode (2026-03-19):
- Eval agent recommended cc, suggested cross-pollinating gg's FOUC script
- User typed "choose cc and close" in eval tmux session
- Got: "Error: Skill aigon:feature-close cannot be used with Skill tool due to disable-model-invocation"
- Had to exit eval session and use dashboard to close
- Dashboard winner picker had no adoption options

## Triage Notes

- Type: feature-request (not a bug — current behavior is by design, just limiting)
- Priority: medium-high — directly impacts the Fleet evaluation workflow
- The eval session is the RIGHT place to close — user has full context about both implementations
- Adoption is a key Fleet value proposition — hiding it behind CLI-only access limits dashboard users

## Proposed Next Action

Create a feature with two parts:
1. Allow `feature-close` from eval tmux sessions (either remove the `disable-model-invocation` block for close, or have the eval template run it via `aigon` CLI directly instead of as a slash command)
2. Add adoption options to dashboard close flow (winner picker should offer "Close", "Close + Adopt from [agent]", "Close + Adopt all")
