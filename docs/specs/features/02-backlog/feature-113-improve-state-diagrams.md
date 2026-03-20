# Feature: improve-state-diagrams

## Summary

Add three vertical-cascade lifecycle SVG diagrams (feature, research, feedback) to `docs/images/` and embed them in the GUIDE.md at the start of each "Detailed Lifecycle" section. The diagrams visually communicate the full workflow including parallel/Fleet mode, replacing the need to read dense text to understand the flow.

## User Stories

- [ ] As a new Aigon user, I can glance at a diagram to understand the feature lifecycle without reading the full text
- [ ] As a user setting up Fleet mode, I can see how parallel agents fork and rejoin in the evaluation step

## Acceptance Criteria

- [ ] `docs/images/feature-lifecycle.svg` exists and renders correctly — shows Inbox → Backlog → In Progress → fork (Drive single-agent / Fleet parallel agents) → Evaluate (Fleet) → Done. Includes `feature-now` fast-track shortcut.
- [ ] `docs/images/research-lifecycle.svg` exists and renders correctly — shows Inbox → Backlog → In Progress → fork (Drive / Fleet parallel findings) → Synthesize (Fleet) → Done. Includes pause/resume side-state.
- [ ] `docs/images/feedback-lifecycle.svg` exists and renders correctly — shows Inbox → Triaged → three-way fork (Actionable → Done, Won't Fix, Duplicate). Shows actionable feeding back into features/research.
- [ ] Each SVG follows a consistent vertical cascade style: coloured rounded-rect nodes, solid arrows for transitions, dashed for optional/feedback, distinct colour for Fleet-only paths.
- [ ] Fleet/parallel nature is shown with side-by-side agent boxes (cc, gg, cx) inside a panel, with convergence lines.
- [ ] Each diagram has a legend explaining arrow types.
- [ ] All three diagrams are embedded in GUIDE.md at the top of their respective "Detailed Feature Lifecycle", "Detailed Research Lifecycle", and "Detailed Feedback Lifecycle" sections.
- [ ] The existing `docs/images/state-machine.svg` (detailed technical diagram) is preserved unchanged.
- [ ] `docs/images/planning-hierarchy.svg` is removed (it was a scratch file, not part of this feature).

## Validation

```bash
# All SVGs must be valid XML
xmllint --noout docs/images/feature-lifecycle.svg
xmllint --noout docs/images/research-lifecycle.svg
xmllint --noout docs/images/feedback-lifecycle.svg
# Existing diagram untouched
git diff --quiet docs/images/state-machine.svg
```

## Technical Approach

All three SVGs are hand-written (no build tool). They follow a shared visual language:

- **Canvas**: light grey `#FAFAFA` background, system font stack
- **Nodes**: rounded rects (`rx="7"`) with fill + border. Colour per domain:
  - Features: blue (`#DBEAFE` / `#93C5FD`)
  - Research: purple (`#EDE9FE` / `#C4B5FD`)
  - Feedback: green (`#D1FAE5` / `#6EE7B7`)
  - Terminal states (Done): `#DCFCE7` / `#86EFAC`
  - Negative states (Won't Fix): `#FEE2E2` / `#FCA5A5`
- **Arrows**: SVG `<marker>` arrowheads. Solid for transitions, dashed (`stroke-dasharray`) for optional/feedback. Fleet-only paths use the domain accent colour.
- **Fleet panels**: a containing rect with side-by-side agent boxes (`cc`, `gg`, `cx`), convergence lines meeting at a point, then "all submitted" label before the next step.
- **Viewbox**: ~540-620px wide, 620-820px tall. Designed to render well in GitHub markdown and docs sites at default width.

### Recreating the diagrams

The SVGs are source-of-truth — edit them directly. The design rules above and the acceptance criteria are sufficient to recreate them from scratch if needed. The node labels and transitions must match `lib/state-machine.js` and the GUIDE.md lifecycle descriptions.

To regenerate from scratch:
1. Read `lib/state-machine.js` for the authoritative transitions
2. Read the GUIDE.md lifecycle sections for the command names at each step
3. Follow the visual language above (colours, arrow styles, Fleet panel pattern)
4. Validate with `xmllint --noout`

## Dependencies

- Existing: `docs/images/state-machine.svg` (preserved, not replaced)
- Existing: GUIDE.md lifecycle sections (embedding target)

## Out of Scope

- Modifying the existing `state-machine.svg` (that's the detailed technical reference)
- Auto-generating SVGs from `lib/state-machine.js` (manual is fine for 3 diagrams)
- Agent status sub-states (idle/implementing/waiting/submitted) — those stay in the existing detailed diagram
- Interactive or animated diagrams

## Open Questions

- None

## Related

- `docs/images/state-machine.svg` — existing detailed technical state machine diagram
- `lib/state-machine.js` — source of truth for transitions
- Feature 62 (unified-state-machine) — created the state machine module
