# Feature: aigon-site-vocabulary-update

## Summary

Update the aigon.build website documentation to reflect the new command vocabulary established in `command-vocabulary-rename`. All references to old command names (implement, conduct, done) must be updated to the new names (do, autopilot, close) across the website content, terminal emulation demos, and any interactive examples.

## Vocabulary Reference

| Old | New |
|-----|-----|
| `feature-do` | `feature-do` |
| `feature-close` | `feature-close` |
| `research-do` | `research-do` |
| `research-close` | `research-close` |
| `feature-autopilot` (orchestrator) | `feature-autopilot` / `research-autopilot` |

Full workflow table:

| Stage | Feature (Drive) | Feature (Fleet) | Research (Drive) | Research (Fleet) | Feedback |
|-------|----------------|-----------------|-----------------|-----------------|----------|
| **Capture** | `feature-create` | `feature-create` | `research-create` | `research-create` | `feedback-create` |
| **Triage** | `feature-prioritise` | `feature-prioritise` | `research-prioritise` | `research-prioritise` | `feedback-triage` |
| **Prepare** | `feature-setup` | `feature-setup` | `research-setup` | `research-setup` | — |
| **Do the work** | `feature-do` | each agent: `feature-do` | `research-do` | each agent: `research-do` | — |
| **Submit for evaluation** | `feature-submit` | each agent: `feature-submit` | — | each agent: `research-submit` | — |
| **Evaluate** | — | `feature-eval` | — | `research-synthesize` | — |
| **Fix issues** | `feature-review` (optional) | `feature-review` (optional) | — | — | — |
| **Finish** | `feature-close` | `feature-close` | `research-close` | `research-close` | — |
| **Autopilot** | — | `feature-autopilot` | — | `research-autopilot` | — |

## User Stories

- [ ] As a visitor to aigon.build, I see the current command names — not stale references to `implement`, `feature-autopilot`, or `done`
- [ ] As a visitor, I can see the full workflow table showing Drive vs Fleet pathways with correct command names

## Acceptance Criteria

- [ ] All website pages updated with new command names
- [ ] Terminal emulation/demo sections show new commands
- [ ] Any workflow diagrams or stage descriptions use the new vocabulary
- [ ] The locked vocabulary table is included in the documentation section of the site

## Technical Approach

1. Search all content files in the aigon-site repo for old command names
2. Replace with new names
3. Add the vocabulary table to the appropriate docs page
4. Update any terminal demo scripts/recordings

## Dependencies

- `command-vocabulary-rename` must be completed first (provides the CLI changes)

## Out of Scope

- Creating the demo video (that's research-08)
- Redesigning the site layout or structure
- Adding new pages — only updating existing content

## Related

- Depends on: `command-vocabulary-rename`
- Research 08: `aigon-demo-video-style` (video will use new vocabulary)
