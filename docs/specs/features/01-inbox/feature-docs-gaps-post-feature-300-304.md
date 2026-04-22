# Feature: docs gaps post F280–F304

## Summary

Ten features shipped over the past week left documentation gaps: missing pages, missing reference entries, stale screenshots, and guide sections that don't yet cover new dashboard capabilities. This feature fills all of them. Where a real screenshot doesn't exist yet, insert a `[PLACEHOLDER]` image comment so the user can drop in a real one later.

## User Stories

- [ ] As a user reading the dashboard guide, I can see documented sections for every new card capability: awaiting-input badge, model picker badge, rebase warning, review-check statuses ("Addressing review" / "Feedback addressed"), and the "Close with agent" button.
- [ ] As a user looking up `aigon nudge` in the command reference, I find a dedicated reference page with synopsis, options, and examples.
- [ ] As a user looking up `aigon feature-rename` or `aigon research-rename`, I find a reference page.
- [ ] As a user reading the feedback workflow guide, all mentions of `feature-review` have been updated to `feature-code-review`.
- [ ] As a user reading the troubleshooting guide, I find an entry explaining the rebase-needed warning and how to resolve it before closing.
- [ ] As a user reading the autonomous mode guide, I can see that the dashboard shows the full planned stage sequence from the moment a run starts.

## Acceptance Criteria

- [ ] `site/content/reference/commands/infra/nudge.mdx` (or appropriate path) exists with full synopsis, flags, and examples for `aigon nudge`.
- [ ] `site/content/reference/commands/feature/feature-rename.mdx` exists.
- [ ] `site/content/reference/commands/research/research-rename.mdx` exists.
- [ ] `site/content/guides/dashboard.mdx` has sections for: Awaiting input, Model picker, Rebase warning, Review-check statuses, Close with agent — each with a `[PLACEHOLDER]` image where a screenshot is needed.
- [ ] `site/content/guides/feedback-workflow.mdx` uses `feature-code-review` / `feature-code-review-check` throughout (no surviving references to the old `feature-review` name).
- [ ] `site/content/guides/troubleshooting.mdx` has a "Rebase needed before close" entry pointing to the rebase warning on dashboard cards.
- [ ] `site/content/guides/autopilot-mode.mdx` mentions that the dashboard shows the full planned stage sequence at run start.
- [ ] All `[PLACEHOLDER]` markers use a consistent format: `{/* PLACEHOLDER: description of screenshot needed */}` as an MDX comment inline with the surrounding prose.
- [ ] `npm run build --prefix site` exits 0 (no broken MDX, no missing imports).

## Validation

```bash
npm run build --prefix site 2>&1 | tail -20
```

## Pre-authorised

- May skip `npm test` and `MOCK_DELAY=fast npm run test:ui` — this feature touches only `site/content/` docs files and no `lib/` or dashboard JS.
- May skip `bash scripts/check-test-budget.sh` — no test files are added or modified.

## Technical Approach

### Gaps inventory

**New reference command pages needed:**

| File | Command | Shipped in |
|------|---------|-----------|
| `reference/commands/infra/nudge.mdx` | `aigon nudge <ID> [agent] "message"` | F295 |
| `reference/commands/feature/feature-rename.mdx` | `aigon feature-rename <old> <new>` | today (entity-commands) |
| `reference/commands/research/research-rename.mdx` | `aigon research-rename <old> <new>` | today (entity-commands) |

**Dashboard guide sections to add** (after existing "Feature cards" section):

1. **Awaiting input** (F285/F293) — agents emit `aigon agent-status awaiting-input "<question>"` when blocked; the card shows a pulsing badge with the question. Auto-clears on next status. `[PLACEHOLDER: awaiting-input badge on a card]`

2. **Model and effort picker** (F291) — when starting a feature from the dashboard, each agent slot has a model + effort dropdown. The chosen triplet persists in engine state and survives restarts. The badge shows on the card after selection. `[PLACEHOLDER: model picker dropdown in start dialog]` and `[PLACEHOLDER: model/effort badge on agent row]`

3. **Rebase warning** (F300) — when main has commits the feature branch doesn't, a warning appears on the card before the user tries to close. `[PLACEHOLDER: rebase warning on card]`

4. **Review-check statuses** (F304) — after a code review completes, the implementing agent's row shows "Addressing review" (amber dot) while it works through feedback, then "Feedback addressed" (muted checkmark) when done. `[PLACEHOLDER: addressing-review and feedback-addressed badges]`

5. **Close with agent** — if `feature-close` fails (merge conflict or other error), a "Close with agent" button appears on the card to spawn an agent session to resolve the block. `[PLACEHOLDER: close-with-agent button on card]`

**Guide updates:**

- `feedback-workflow.mdx`: s/feature-review/feature-code-review/g, s/feature-review-check/feature-code-review-check/g
- `autopilot-mode.mdx`: add note that dashboard shows full planned stage sequence immediately at autonomous run start, not just the active stage
- `troubleshooting.mdx`: add "Rebase needed before close" section — explains the warning, instructs user to `git rebase main` in the worktree, then retry `aigon feature-close`

### Placeholder format

Use MDX comments so they survive builds but are visible in the source:

```mdx
{/* PLACEHOLDER: screenshot of awaiting-input badge on a dashboard card */}
```

Place each one on its own line immediately after the sentence that references the screenshot.

### Reference page format

Follow the pattern of existing reference pages (e.g. `feature-code-review.mdx`): frontmatter title/description, Synopsis, Shortcuts (if any), Description, Usage, Options/flags, Examples.

## Dependencies

- None

## Out of Scope

- Capturing real screenshots (user will supply these after the placeholders land).
- Documenting internal engine changes (F283 workflow-backed spec review state, F292 entity-command unification, F281/F280 route extract) — these are not user-facing.
- Updating tutorial GIFs.

## Open Questions

- Should `nudge` live under `reference/commands/infra/` (alongside `server`) or get its own top-level entry? Proposal: `infra/` since it's an operator utility not part of the feature lifecycle.

## Related

- F295: nudge-agent-channel
- F300: feature-close-rebase-gate
- F304: dashboard-review-check-status-indicators
- F299: rename-feature-review-to-feature-code-review
- F297: autonomous-mode-stage-status
- F293: agent-idle-detector-and-spec-preauth
- F291: dashboard-agent-model-picker
- F285: awaiting-input-signal
