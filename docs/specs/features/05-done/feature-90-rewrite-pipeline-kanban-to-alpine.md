# Feature: rewrite-pipeline-kanban-to-alpine

## Summary
Rewrite the Pipeline (kanban) tab to use Alpine.js templates exclusively, eliminating the vanilla JS `buildKanbanCard()` function and 200+ lines of imperative DOM manipulation. Currently the dashboard has a split architecture: Monitor tab uses Alpine.js (reactive, declarative `x-for` templates), but Pipeline uses a hybrid — Alpine for columns, vanilla JS for card rendering via `renderKanbanColCards()` → `buildKanbanCard()`. This means every UI fix (like the Drive mode display) requires changes in two places with different patterns.

## User Stories
- [ ] As a developer, I want to fix a card display issue once and have it work in both Monitor and Pipeline tabs
- [ ] As a developer, I want to understand one rendering pattern (Alpine) not two (Alpine + vanilla JS)
- [ ] As a user, I want consistent card appearance between Monitor and Pipeline views

## Acceptance Criteria
- [ ] `buildKanbanCard()` function removed entirely
- [ ] `renderKanbanColCards()` function removed (was the bridge between Alpine and vanilla JS)
- [ ] Pipeline cards rendered via Alpine `x-for` templates, matching the Monitor tab pattern
- [ ] `buildAgentSectionHtml()` replaced with an Alpine template (shared between Monitor and Pipeline)
- [ ] `buildAgentStatusHtml()` shared function still works (used by both views)
- [ ] `buildValidActionsHtml()` replaced with Alpine template or shared function
- [ ] `isSoloDriveBranch` / Drive mode display works identically in both views
- [ ] Drag-and-drop between columns still works (Alpine event handlers)
- [ ] Card click to open spec drawer still works
- [ ] Overflow menu (⋯) still works
- [ ] Card expand/collapse for capped columns (inbox/backlog 8-item limit) still works
- [ ] All existing Playwright dashboard tests pass
- [ ] No vanilla JS DOM manipulation for card rendering remains in `index.html`
- [ ] Net reduction in `index.html` line count (removing ~200 lines of vanilla JS card builders)

## Validation
```bash
node -c lib/utils.js
npx playwright test tests/dashboard/ --reporter=list 2>/dev/null || echo "Playwright tests skipped (not installed)"
# Verify buildKanbanCard is gone
grep -c "buildKanbanCard" templates/dashboard/index.html | xargs test 0 -eq
grep -c "renderKanbanColCards" templates/dashboard/index.html | xargs test 0 -eq
```

## Technical Approach

### Current architecture (the problem)
```
Monitor tab:
  Alpine x-for → agent row template (declarative, reactive)

Pipeline tab:
  Alpine x-for stages → x-effect renderKanbanColCards($el, repo, stage)
    → buildKanbanCard() (vanilla JS, imperative DOM)
      → buildAgentSectionHtml() (string concatenation)
      → buildAgentStatusHtml() (shared with Monitor)
      → isSoloDriveBranch logic (duplicated)
```

### Target architecture
```
Both tabs:
  Alpine x-for → shared card template component
    → agentDisplayName() (shared helper)
    → buildAgentStatusHtml() (shared helper, returns HTML string)
    → isSoloDrive() (shared helper)
```

### Implementation approach

**Step 1: Create Alpine card template for Pipeline**
Replace `<div class="col-body" x-effect="renderKanbanColCards(...)">` with:
```html
<div class="col-body">
  <template x-for="feature in getStageFeatures(repo, stage)">
    <div class="kcard" draggable="true" ...>
      <!-- Alpine template matching current card structure -->
    </div>
  </template>
</div>
```

**Step 2: Move card logic into Alpine component methods**
- `getStageFeatures(repo, stage)` — returns sorted features for a stage (already exists as part of renderKanbanColCards)
- Card click, drag events become Alpine `x-on:` handlers
- Agent sections use same helper functions as Monitor

**Step 3: Remove vanilla JS card builders**
- Delete `buildKanbanCard()` (~100 lines)
- Delete `renderKanbanColCards()` (~30 lines)
- Delete `buildAgentSectionHtml()` (~25 lines)
- Delete `buildValidActionsHtml()` (~30 lines)
- Keep shared helpers: `buildAgentStatusHtml()`, `isSoloDrive()`, `agentDisplayName()`, `AGENT_DISPLAY_NAMES`

**Step 4: Verify drag-and-drop**
Drag-and-drop uses `draggable`, `dragstart`, `dragover`, `drop` events. These work fine with Alpine `x-on:` handlers. The `x-on:dragstart` sets feature ID + source stage; `x-on:drop` dispatches the action.

### Key constraint
The Pipeline has features from ALL stages (inbox through done), while Monitor only shows in-progress/in-evaluation. The Alpine template needs to handle:
- Inbox/backlog cards (no agents, simple name + actions)
- In-progress cards (agent sections with status dots)
- Done cards (minimal, no actions)
- 8-item cap with expand/collapse for inbox/backlog

## Dependencies
- Feature 91 (fix ctx regressions) — should go first so the codebase is stable
- Feature 92 (split dashboard HTML) — could be done before or after, but after is easier (one file to work with)

## Out of Scope
- Rewriting the Monitor tab (already uses Alpine — no changes needed)
- Changing the data model or API
- Adding new Pipeline features
- Splitting index.html into separate files (that's feature 92)

## Open Questions
- Should the shared card template be an Alpine `x-component` or just inline `x-for` with helpers?
- Should the expand/collapse (8-item cap) use Alpine `x-show` or keep the current JS toggle?

## Related
- Feature 88: worktree-agent-scope-guard (added Drive mode display — had to fix both views separately)
- Feature 92: split-dashboard-html-into-modules (splitting the HTML file)
- Current vanilla JS card code: `templates/dashboard/index.html` lines 2108-2280
