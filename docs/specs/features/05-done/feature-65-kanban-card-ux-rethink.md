# Feature: kanban-card-ux-rethink

## Summary

Rethink how feature/research cards render in the Pipeline (Kanban) view so that every element on a card is immediately understandable. The state machine already computes valid actions — the dashboard just needs to render them clearly with obvious visual hierarchy: status at the top, primary action prominent, secondary actions subdued.

## Problem

The current Kanban cards are confusing:
1. **Status badges look like buttons** — `evaluating` badge is visually indistinguishable from action buttons, users try to click it.
2. **No action hierarchy** — destructive actions (Close) and optional actions (Review) have equal visual weight.
3. **Button labels are ambiguous** — "Review" could mean "I want to look at it" or "run an AI code review agent". "Close" doesn't convey finality.
4. **Solo features in evaluation make no sense** — a solo feature shouldn't need an evaluation stage; it should be closeable directly from in-progress.
5. **The state machine is well-designed but the UI doesn't reflect it** — valid actions are computed correctly, but rendered as a flat bag of same-looking buttons.

## User Stories

- [ ] As a user, I can glance at a card and immediately know what stage it's in and what I should do next
- [ ] As a user, I can distinguish status indicators from clickable actions without thinking
- [ ] As a user, the primary/recommended action is visually obvious (larger, coloured, prominent)
- [ ] As a user, secondary/dangerous actions are available but not competing for attention
- [ ] As a user, solo features don't go through a confusing "evaluation" stage

## Acceptance Criteria

- [ ] Status indicators (eval status, agent statuses) are clearly non-interactive — no button styling, muted colours, different visual treatment
- [ ] Each card has at most ONE primary action button (the recommended next step), styled prominently
- [ ] Secondary actions (close, review, stop) are visually subdued (smaller, outline/ghost style, or behind overflow)
- [ ] Button labels are unambiguous: use verb phrases that describe what happens (e.g. "Run Review" not "Review", "Accept & Close" not "Close")
- [ ] Solo features: the state machine allows closing directly from in-progress (already works) — the dashboard should surface this path clearly instead of routing through evaluation
- [ ] Fleet features: evaluation flow is preserved but with clear hierarchy (Evaluate = primary, Close = secondary)
- [ ] The `validActions` system from the state machine is the ONLY source of truth for what buttons appear — no more legacy fallback code
- [ ] All existing tests pass (`npm test`)
- [ ] Dashboard loads and renders correctly in browser

## Validation

```bash
node --check aigon-cli.js
npm test
```

## Technical Approach

### Principle: The state machine already knows what to do — just render it clearly

The state machine (`lib/state-machine.js`) already computes `validActions` with types (`action` vs `transition`), priorities (`high`), and labels. The dashboard should map these directly:

1. **Priority = primary button**: Any action with `priority: 'high'` gets the primary button style
2. **Transitions = secondary**: Stage transitions (close, prioritise) get subdued button style
3. **Status = non-interactive**: Agent badges and eval status are rendered as text/badges, never as buttons

### Changes:

**`templates/dashboard/index.html`**:
- Redesign `buildValidActionsHtml()` to separate status from actions and apply visual hierarchy
- Add CSS for primary vs secondary button distinction
- Remove legacy fallback rendering (the `else` branch in `buildKanbanCard`)
- Improve button labels using state machine labels (already well-named)

**`lib/state-machine.js`**:
- Review and improve action labels for clarity (e.g. "Run Review", "Accept & Close")
- Ensure solo close from in-progress has appropriate label

**`lib/utils.js`** (if needed):
- Ensure `featureSmContext` correctly identifies solo vs fleet

## Dependencies

- State machine (`lib/state-machine.js`) — already well-structured
- Dashboard template (`templates/dashboard/index.html`)
- AIGON server (`lib/dashboard.js`) — should need no changes

## Out of Scope

- Drag-and-drop behaviour (works fine, driven by transitions)
- Monitor tab
- Sessions tab
- Research/feedback card rendering (follow-up if the pattern works well for features)

## Open Questions

- Should we remove the evaluation column entirely for solo features, or just not route them there?
- Should overflow/secondary actions use a "..." menu or just smaller buttons?

## Related

- Feature 64: Dashboard statistics recovery (current branch)
- `lib/state-machine.js`: source of truth for all lifecycle logic
