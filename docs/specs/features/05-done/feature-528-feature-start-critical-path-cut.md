---
complexity: high
set: fleet-startup
depends_on: [527]
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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T10:06:28.078Z", actor: "cli/feature-prioritise" }
---

# Feature: feature-start-critical-path-cut

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Recent Brewboard traces show that dashboard-visible startup is being dominated by the `feature-start` critical path itself. The current implementation does more serial work than necessary, duplicates tmux-session setup, and blocks command completion on terminal-opening behavior that is not required for the feature to be considered started. This feature cuts the critical path of `feature-start` so worktrees and sessions are ready materially sooner, while preserving clean-worktree and workflow-state invariants.

## User Stories
- [ ] As a user starting a multi-agent fleet, the dashboard action returns quickly enough that startup feels responsive rather than frozen.
- [ ] As an Aigon maintainer, I can inspect phase timings and tell exactly which startup sub-step regressed.

## Acceptance Criteria
- [ ] `feature-start` emits greppable phase timing markers for the startup path, including at least spec move, worktree add, worktree setup, trust writes, tmux session creation, and terminal opening.
- [ ] The duplicate tmux/session setup path is removed so startup does not create/ensure the same session twice.
- [ ] GUI terminal opening is taken off the synchronous critical path for fleet starts; `feature-start` can complete successfully once worktrees and detached sessions are ready.
- [ ] The implementation reduces wall-clock time for the traced Brewboard fleet start path relative to the current baseline.
- [ ] Any new concurrency uses bounded or explicitly justified parallelism; no shared-state startup path is parallelized blindly.
- [ ] Clean-worktree semantics remain explicit and tested: a newly started worktree must either remain clean as today or the spec must deliberately redefine that invariant and update affected consumers.
- [ ] `aigon doctor` remains clean after startup.

## Validation
```bash
npm test
```

## Technical Approach
Start by instrumenting the existing path so the next change is measured rather than guessed. Then simplify the orchestration:

- Remove the redundant session work between the per-agent startup block in `lib/feature-start.js` and the later `ensureAgentSessions()` pass.
- Decouple terminal-window opening from the definition of "feature started". Detached tmux sessions are the durable runtime primitive; GUI attachment can happen after the command returns or on-demand.
- Parallelize only the safe per-worktree file/setup work. Treat `git worktree add` conservatively with bounded concurrency and explicit fallback rather than raw `Promise.all` against shared git admin state.
- Audit trust writes and other global config writes so they are batched or narrowed instead of repeated per worktree where possible.
- Preserve or intentionally replace the current clean-worktree contract before removing any setup commit.

This feature should stay scoped to command/runtime orchestration. It should not absorb broader agent boot-time work.

## Dependencies
- `startup-phase-ui`

## Out of Scope
- Reducing model/provider cold-start time after the detached sessions already exist.
- Adding new workflow-core lifecycle states.
- Worktree pools or speculative pre-warming of future features.

## Open Questions
- Can the worktree-setup commit be removed safely, or does some downstream consumer still rely on startup leaving a clean tracked state?
- Is bounded concurrency of `git worktree add` enough on John's machine, or do we need to keep that specific step serial and parallelize only later steps?
- Should fleet terminal opening become fully asynchronous, or should the dashboard simply stop waiting for it?

## Related
- Research:
- Set: `fleet-startup`
- Prior features in set: `startup-phase-ui`
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 528" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-528" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-528)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-528)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#527</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">startup phase ui</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#528</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">feature start critical pa…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#529</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">agent ready latency</text><text x="636" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
