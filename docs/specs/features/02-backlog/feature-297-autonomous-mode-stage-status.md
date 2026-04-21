# Feature: autonomous-mode-stage-status

## Summary
When a feature is running under AutoConductor, the dashboard card should show the full planned autonomous sequence from the moment the run starts, not only the stage that is currently active. A solo run like "implement with Claude Code, then review with Cursor, then close" should render all three stages immediately, with the current stage marked as running and the later stages marked as waiting so the user can see what will happen next.

## User Stories
- [ ] As a user watching an autonomous feature run, I can see the full planned sequence of stages before each later stage starts, so I know whether review and close are queued next.
- [ ] As a user running a reviewed solo workflow or a fleet workflow, I can distinguish between "this stage is running now" and "this stage is planned but not started yet" without opening logs or remembering the workflow definition.

## Acceptance Criteria
- [ ] When an autonomous run starts, the dashboard card shows a stage timeline derived from the selected workflow definition, including future stages that have not started yet.
- [ ] For a solo review workflow, the card shows the implementing agent stage as running, the planned review stage as waiting, any planned counter-review or feedback-addressing step as waiting if the workflow includes it, and the final close stage as waiting until triggered.
- [ ] For a fleet eval workflow, the card shows implement, eval, and close as separate planned stages from the start, with eval and close marked waiting until they begin.
- [ ] Stage labels use the real configured agent for agent-driven stages, so a workflow such as "implement with cc, review with cx" renders Claude Code for implement and Cursor for review before Cursor has started.
- [ ] As AutoConductor advances, each planned stage transitions from waiting to running to complete based on existing engine/session state, without inventing stage state in the dashboard frontend.
- [ ] If the dashboard cannot resolve the workflow plan or autonomous metadata it needs, it fails loudly in the read model and points to `aigon doctor --fix` rather than silently omitting future stages.
- [ ] The implementation ships with regression coverage for the read-side shape that feeds the dashboard card and for at least one rendered autonomous card scenario.

## Validation
```bash
npm test -- tests/integration/workflow-read-model.test.js
npm test -- tests/integration/awaiting-input-dashboard.test.js
```

## Technical Approach
Add a server-owned autonomous stage-plan shape to the feature dashboard payload instead of teaching the frontend to infer future stages from partial runtime evidence. The source of truth for planned stages already exists in `lib/workflow-definitions.js`, and the current runtime evidence already exists across the workflow snapshot, review state, eval session state, and AutoConductor state file. The missing piece is a read-side adapter that combines those sources into a normalized stage timeline for the card.

Introduce a read-model helper that:
- detects whether a feature is in an autonomous run and resolves the workflow definition that AutoConductor is following
- expands that workflow into ordered display stages such as implement, review, counter-review, eval, and close
- attaches configured agent identity and any model/effort metadata already available from the workflow definition
- marks each stage as `waiting`, `running`, `complete`, or `failed` from existing producer state instead of deriving it ad hoc in the browser

Update `lib/dashboard-status-collector.js` / the feature dashboard state path to emit this timeline on each feature row. Then update `templates/dashboard/js/pipeline.js` to render the autonomous timeline block from that server-provided data, keeping the frontend as a pure renderer.

The write-path audit matters here. If the read side needs workflow slug, stop-after target, review agent, eval agent, or close intent and that data is not durably produced when autonomous mode starts, fix the producer in `feature-autonomous-start` / AutoConductor state persistence rather than adding read-side guesswork. This feature should fix the mechanism so every future autonomous run exposes its planned stages up front.

### Card Mockup

The autonomous timeline should read as a compact "planned run" block inside the existing feature card. The active stage is obvious, future stages are visible but quieter, and the card answers "what is running now, what happens next, and will this auto-close?" without opening logs.

Solo reviewed workflow:

```text
┌──────────────────────────────────────────────────────────┐
│ #294 autonomous mode stage status                       │
│                                                          │
│ Autonomous plan                                          │
│                                                          │
│ ● Implement        Claude Code              Running      │
│ │                                                        │
│ ○ Review           Cursor                   Waiting      │
│ │                                                        │
│ ○ Close                                     Waiting      │
└──────────────────────────────────────────────────────────┘
```

Review in progress with a follow-up counter-review:

```text
┌──────────────────────────────────────────────────────────┐
│ #294 autonomous mode stage status                       │
│                                                          │
│ Autonomous plan                                          │
│                                                          │
│ ✓ Implement        Claude Code             Complete      │
│ │                                                        │
│ ● Review           Cursor                  Running       │
│ │                                                        │
│ ○ Counter-review   Claude Code             Waiting       │
│ │                                                        │
│ ○ Close                                    Waiting       │
└──────────────────────────────────────────────────────────┘
```

Fleet workflow:

```text
┌──────────────────────────────────────────────────────────┐
│ #295 improve dashboard telemetry                        │
│                                                          │
│ Autonomous plan                                          │
│                                                          │
│ ● Implement        CC, CX, GG               Running      │
│ │                                                        │
│ ○ Evaluate         Claude Code              Waiting      │
│ │                                                        │
│ ○ Close                                     Waiting      │
└──────────────────────────────────────────────────────────┘
```

Visual intent:
- Keep this as a single vertical timeline block rather than separate detached pills
- Use `✓` for complete, `●` for running, and `○` for waiting
- Show configured agent names inline on the same row as the stage label
- Keep future stages visible but visually quieter than the active stage
- Treat this block as read-only status, not an action surface

## Dependencies
- Existing workflow definition plumbing in `lib/workflow-definitions.js`
- Existing autonomous run-state persistence in `.aigon/state/feature-<id>-auto.json`

## Out of Scope
- Redesigning the whole dashboard card layout beyond what is needed to show planned autonomous stages clearly
- Changing autonomous orchestration order or introducing new workflow stage types
- Adding dashboard action buttons in frontend code

## Open Questions
- Should the solo feedback-injection wait after review be shown as its own explicit stage, or is it better treated as part of the implementation stage returning from review?
- Should completed autonomous stages remain visible after the feature closes, or only while the card is still outside `done`?

## Related
- [docs/autonomous-mode.md](/Users/jviner/src/aigon/docs/autonomous-mode.md)
- [docs/architecture.md](/Users/jviner/src/aigon/docs/architecture.md)
- [lib/workflow-definitions.js](/Users/jviner/src/aigon/lib/workflow-definitions.js)
- [lib/dashboard-status-collector.js](/Users/jviner/src/aigon/lib/dashboard-status-collector.js)
- [templates/dashboard/js/pipeline.js](/Users/jviner/src/aigon/templates/dashboard/js/pipeline.js)
