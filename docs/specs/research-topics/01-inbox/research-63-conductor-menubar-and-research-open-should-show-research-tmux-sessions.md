---
complexity: "medium"
origin: "customer-feedback"
reporter:
  name: ""
  identifier: ""
source:
  channel: "internal"
  reference: ""
feedback_refs:
  - "feedback:1"
  - "docs/specs/feedback/01-inbox/feedback-1-conductor-menubar-and-research-open-should-show-research-tmux-sessions.md"
type: "feature-gap"
---

# Research: conductor menubar and research-open should show research tmux sessions

## Context

Two gaps in research session visibility: 1. **Conductor menubar (`menubar-render`) ignores research sessions.** It only scans `docs/specs/features/03-in-progress/` and worktrees matching `feature-{ID}-{AGENT}-*`. Research tmux sessions (`aigon-r8-cc`, `aigon-r8-cx`, `aigon-r8-gg`) are invisible in the menu bar — no way to see their status or click to focus them. 2. **`research-open` should set both the tmux session name AND the window name** using the same naming convention (`aigon-r{ID}-{AGENT}`). Currently the window name may not be set, which makes it harder for the menubar plugin and `terminal-focus` to discover and display research sessions consistently.

## Evidence

- Ran `/aro 08` which created 3 tmux sessions (`aigon-r8-cc`, `aigon-r8-cx`, `aigon-r8-gg`) — all attached and running - Menu bar showed no research sessions; only features visible - `menubar-render` in `lib/commands/shared.js:3859` only processes `feature-*` specs and worktrees - `terminal-focus` also only matches `feature-{ID}-{AGENT}-*` worktree patterns

## Triage Notes

High priority — directly impacts usability of Fleet research mode.

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