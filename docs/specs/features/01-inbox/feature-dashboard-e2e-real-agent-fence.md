---
complexity: high
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

# Feature: dashboard-e2e-real-agent-fence

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Fence the dashboard E2E stack so the default browser suite stays mock-only and cannot accidentally launch real Claude Code or other paid agent sessions. Add an explicit opt-in live-agent smoke path for maintainer use, sanitize the test bootstrap so model-override env vars cannot leak into CI runs, and remove or quarantine any orphaned env-specific E2E artifacts that are not part of the supported runner set.

## User Stories
- [ ] As a CI user, I can run the default dashboard E2E suite without burning provider quota or depending on a live model being available.
- [ ] As a maintainer, I can run a separate opt-in live-agent smoke check when I want to verify the harness against a real agent session.
- [ ] As a contributor, I can tell from the repo structure and test bootstrap which paths are mock-only and which ones are intentionally live.

## Acceptance Criteria
- [ ] `tests/dashboard-e2e/setup.js` explicitly fences the default suite so it cannot inherit live-agent model overrides or other env state that could route `feature-start` into a real model session.
- [ ] The default `npm run test:browser` / `npm run test:ui` path remains mock-only and does not require any live agent login, quota, or model availability.
- [ ] Any live-agent browser smoke path is opt-in only, gated behind a clearly named env var, and is skipped by default in CI.
- [ ] The live-agent smoke path uses pinned, supported model IDs and fails closed if the live-agent prerequisites are not present.
- [ ] Orphaned env-specific E2E artifacts that are not part of the supported runner set are removed or moved behind the explicit opt-in path.
- [ ] The repo docs and test comments explain the split clearly enough that a maintainer can tell which path is safe to run on every push.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
```

## Technical Approach
Audit the dashboard E2E bootstrap, the agent-launch env propagation, and the test runner scripts together. The fix should make the safe path obvious and enforceable: the default Playwright config stays isolated from live model selection, the opt-in live-agent smoke uses a separate entrypoint and explicit guard, and the docs/scripts no longer imply that unsupported env-specific test artifacts are part of the supported suite.

## Dependencies
-

## Out of Scope
- Changing the core workflow engine or quota classifier logic.
- Adding new live model discovery or benchmark tooling.
- Making the default browser suite depend on a real provider connection.

## Open Questions
- Should the opt-in live-agent smoke live in `tests/dashboard-e2e/` as a skipped Playwright spec, or in a separate runner script that is never invoked by `test:browser`?

## Related
- Research:
- Set:
- Prior features in set:
