# Feature: review-signalling-and-viewing

## Summary

When a review is run on a solo worktree feature, there is currently no way to track the review's progress from the dashboard — the feature card stays at "Submitted" with no indication a review is happening, and the user must manually peek at tmux sessions to know when the review is done. This feature adds review status signalling (the review agent signals when it starts and completes), dashboard visibility (review badge on cards, jump-to-session, view review output), and metadata capture for future insights analysis.

## Background & Design Decisions

### Review model: direct-commit, no round-trip

The review agent commits fixes directly to the worktree branch. There is no lifecycle event to send changes back to the implementing agent for approval. In practice, implementing agents never reject review changes — they accept them as valid. This keeps the model simple:

```
submitted → review-in-progress → review-complete → close
```

No back-and-forth. The review agent is trusted to make good changes.

### Where review fits in the feature lifecycle

A review is a sub-state within `in-progress`, not a separate stage. The feature stays in `in-progress` throughout. The review is a checkpoint that happens after an agent submits, before the user closes.

### Multiple review cycles

Reviews happen in sequence, one at a time. A review can only be initiated when the agent status is `submitted` (or after a previous review completes). The manifest tracks the current review slot — if a review is in-progress, another review request is blocked. When complete, the slot clears for either another review cycle or close.

```
submitted → review 1 → complete → review 2 → complete → close
```

Each cycle is numbered for analytics.

### Data capture for insights

The fact that a review happened, who did it, and the cycle count is stored in the manifest. This enables future Pro insights such as:
- "cc implement + gg review produces the fewest post-merge issues"
- "Features that go through 2+ review cycles take 3x longer to close"
- "Codex reviews catch more styling issues than Claude Code reviews"

## User Stories

- [ ] As a user who requested a review, I want to see "Reviewing (gg)" on the feature card so I know a review is in progress without checking tmux
- [ ] As a user, I want to click a button on the card to jump to the review agent's tmux session so I can watch or interact with the reviewer
- [ ] As a user, I want to know when the review is complete so I can close the feature or request another review cycle
- [ ] As a user, I want review metadata captured so I can later analyse which agent combinations produce the best results

## Acceptance Criteria

### Status signalling
- [ ] Review agent runs `aigon agent-status reviewing` when it starts the review
- [ ] Review agent runs `aigon agent-status review-complete` when it finishes
- [ ] These statuses are written to the feature manifest's review field
- [ ] Only one review can be active at a time per feature — attempting a second review while one is in-progress is blocked

### Dashboard visibility
- [ ] Feature card shows a "● Reviewing (gg)" badge when a review is in-progress
- [ ] Feature card shows "✓ Review complete" when the review finishes
- [ ] A "View" or "Peek" button appears on the review badge to jump to the review tmux session
- [ ] Review status is visible on both Pipeline and Monitor views

### Sequence enforcement
- [ ] A review can only be initiated when the feature has at least one agent with status `submitted`
- [ ] While a review is in-progress, `feature-close` is blocked (or warns)
- [ ] After review-complete, the user can close, start another review, or re-open the implementing agent

### Metadata capture
- [ ] Manifest stores review history: `{ agent, startedAt, completedAt, cycle }`
- [ ] Review history persists across multiple cycles (array, not overwritten)
- [ ] Data is accessible for future insights/reports features

## Validation

```bash
node -c lib/state-machine.js
node -c lib/manifest.js
node -c lib/dashboard-server.js
node -c templates/dashboard/js/pipeline.js
node -c templates/dashboard/js/monitor.js
```

## Technical Approach

### Manifest schema

Add a `review` field to the feature manifest (`lib/manifest.js`):

```json
{
  "status": "submitted",
  "review": {
    "current": {
      "agent": "gg",
      "status": "in-progress",
      "startedAt": "2026-03-28T10:00:00Z",
      "completedAt": null,
      "cycle": 1
    },
    "history": [
      {
        "agent": "cx",
        "status": "complete",
        "startedAt": "2026-03-28T08:00:00Z",
        "completedAt": "2026-03-28T08:15:00Z",
        "cycle": 1
      }
    ]
  }
}
```

### Agent status commands

Extend the `agent-status` command to accept `reviewing` and `review-complete`:
- `aigon agent-status reviewing` — sets `review.current.status = 'in-progress'`
- `aigon agent-status review-complete` — sets `review.current.status = 'complete'`, moves to history

These are called by the review agent the same way implementing agents call `agent-status implementing` and `agent-status submitted`.

### State machine guard

Add a guard in `requestTransition()`:
- `feature-review` action: only allowed when at least one agent is `submitted` and no review is `in-progress`
- `feature-close` action: warn (or block) if a review is `in-progress`

### Dashboard UI

**Pipeline card** (`pipeline.js`):
- Below the agent rows, show a review section when `review.current` exists:
  - "● Reviewing (gg)" with status color (blue = in-progress, green = complete)
  - Peek/View button to jump to the review tmux session
  - Session name follows existing pattern: `{repo}-f{id}-review-{agent}`

**Monitor view** (`monitor.js`):
- Same review badge on the feature card
- Review agent appears in the agent list with a "reviewer" role indicator

### Review agent prompt

Update the `feature-review` command template to include the status signals:
1. `aigon agent-status reviewing` at start
2. Do the review work (read code, commit fixes)
3. `aigon agent-status review-complete` at end

### Key files
- `lib/manifest.js` — add review field to manifest schema, read/write review state
- `lib/state-machine.js` — add guards for review sequencing
- `lib/commands/feature.js` — `feature-review` command, agent-status extensions
- `templates/generic/commands/feature-review.md` — add status signal instructions
- `templates/dashboard/js/pipeline.js` — review badge and peek button on cards
- `templates/dashboard/js/monitor.js` — review badge on monitor cards
- `lib/dashboard-server.js` — include review state in status data

## Dependencies

- Existing review flow (`feature-review` command) must continue working
- Peek panel must be functional (already is)

## Out of Scope

- Round-trip review (sending changes back to the implementing agent for approval)
- Automated review triggering (auto-review on submit) — future autonomous mode feature
- Review diff view in the dashboard (showing what the reviewer changed)
- Review quality scoring or approval/rejection verdicts

## Open Questions

- Should `feature-close` be hard-blocked while a review is in-progress, or just warn?
- Should the review badge show on the agent row that was reviewed, or as a separate section on the card?
- Should review history be visible in the spec drawer or only accessible via insights?

## Related

- Feature: research-findings-peek-panel (similar Peek integration pattern)
- Research: autonomous-mode-as-pro (review signalling is a prerequisite for autonomous builds)
- `lib/state-machine.js` — existing transition guards
- `templates/generic/commands/feature-review.md` — review agent prompt template
