---
complexity: high
set: fleet-startup
depends_on: feature-start-critical-path-cut
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: agent-ready-latency

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Even after `feature-start` returns, recent Brewboard traces show a much larger delay before agents become meaningfully ready. The current system treats "startup" as if it ends at command completion, but demo quality and real UX are dominated by the gap from detached session launch to first heartbeat and then to `agent_ready`. This feature instruments and reduces that post-start latency so users see agents become active sooner and the system can distinguish "setup complete" from "agent actually booted".

## User Stories
- [ ] As a user starting a fleet, I see agents become active quickly after the feature card moves to in-progress rather than waiting through a long silent gap.
- [ ] As an Aigon maintainer, I can tell whether startup slowness is caused by `feature-start` orchestration or by agent boot/provider latency after launch.

## Acceptance Criteria
- [ ] The system captures measurable timestamps or derived metrics for at least these intervals: `feature.started -> first heartbeat`, `first heartbeat -> agent_ready`, and fleet-wide `feature.started -> all ready`.
- [ ] The implementation exposes enough startup/readiness timing data in logs, telemetry, or read-side status to compare before/after runs on Brewboard.
- [ ] At least one concrete post-start latency reduction is shipped, not just instrumentation.
- [ ] If a new intermediate runtime status is introduced, it is clearly defined as read-side or signal-level state and does not casually expand workflow-core lifecycle without the full required engine audit.
- [ ] The dashboard can distinguish "feature setup finished" from "agents are still booting" in a way that improves user comprehension.
- [ ] A new Brewboard measurement is captured after the change so the effect on agent-ready latency is explicit.

## Validation
```bash
npm test
```

## Technical Approach
Treat this as a separate system from `feature-start` wall-clock optimization. Begin with instrumentation across workflow events, agent-status writes, and tmux/session launch points so we can attribute delay to the right segment. Likely work includes:

- emitting or deriving an earlier "session live / agent booting" signal before full `agent_ready`
- tightening startup prompts and launch-time context where it is safe
- removing avoidable post-launch bootstrap work from agent entry paths
- reviewing provider/model-specific cold-start behavior where one agent class dominates the gap

The important constraint is not to paper over the problem with fake workflow states. If an intermediate notion is needed, prefer read-side/render metadata or explicit signal-level status unless there is a strong reason to extend the engine lifecycle.

## Dependencies
- `feature-start-critical-path-cut`

## Out of Scope
- Reworking the entire workflow engine solely to add a cosmetic state.
- General-purpose benchmark infrastructure unrelated to startup/readiness.
- Solving all provider quota or long-running model latency issues beyond startup readiness.

## Open Questions
- Is the right first intermediate status `agent_started`, `session_live`, `booting`, or no new surfaced status at all?
- Which part of the post-start gap is dominant on current Brewboard traces: provider launch, prompt/context load, repo bootstrap, or signal emission?
- Should fleet-level "all ready" be surfaced more prominently in the card UI once the earlier phases are complete?

## Related
- Research:
- Set: `fleet-startup`
- Prior features in set: `startup-phase-ui`, `feature-start-critical-path-cut`
