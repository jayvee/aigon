---
complexity: medium
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
  - { from: "inbox", to: "backlog", at: "2026-04-29T05:13:01.458Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-process-leak-hardening

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Fix the worktree launch lifecycle so agent processes don't accumulate as multi-week orphans. Diagnosed 2026-04-29 after a benchmark sweep failed with 'tmux not on PATH' (false diagnosis: actually fork() EAGAIN at the kern.maxprocperuid limit). Root causes layered: (1) The cleanup trap in lib/worktree.js calls 'aigon agent-status submitted' with no timeout — when the dashboard server is unresponsive (or, as the user just noted, when the agent-status CLI invocation shape is itself out of date — 'aigon agent-status submitted' is no longer a valid command), the trap hangs forever, the bash wrapper never exits, every downstream child stays alive. (2) The heartbeat sidecar uses 'while kill -0 $' as its only stop condition — '$' in a bash subshell expands to the parent shell's PID, but the parent stays alive while stuck in the trap (cause #1) so the loop runs forever. No tmux-session-existence check, no max-runtime ceiling. (3) lib/worktree.js:resolveTmuxBinary swallows fork errors silently and returns null, surfacing 'tmux is not installed or not available in PATH' when the actual error is EAGAIN/EMFILE (system at process limit). Misdiagnosis hides the real cause. (4) No 'aigon doctor --reap-orphans' tooling — operators have no clean way to recover when leaks have already accumulated; manual ps-and-kill is fragile. Concrete bundled fixes: (A) bound the agent-status call in the trap to a hard timeout (default 5s) and fail-fast — same for any other status updates fired from the trap; verify the command shapes are still current and update them if not, including the 'submitted' status which is no longer a recognised value. (B) replace the heartbeat loop's single stop condition with three independent guards: parent-alive AND tmux-has-session AND elapsed-time-under-ceiling (default 6h, configurable). (C) make resolveTmuxBinary distinguish ENOENT from EAGAIN/EMFILE; on fork-starvation throw a useful error pointing at 'aigon doctor --reap-orphans' instead of pretending tmux is missing. Audit similar spawnSync sites in lib/perf-bench.js (runShell/runShellCapture) and elsewhere. (D) add 'aigon doctor --reap-orphans' that finds bash wrappers with PPID==1 whose argv contains 'AIGON_ENTITY_TYPE=', their descendants, heartbeat-while-loop subshells, and hanging 'aigon agent-status' invocations older than N seconds; offers --dry-run and interactive confirmation before SIGTERM, then SIGKILL stragglers. Sequencing matters: A is the highest-leverage fix (kills the recurrence vector), B is belt-and-braces, C is diagnostic clarity, D is the cleanup tool.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ]
- [ ]

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ]
- [ ]

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the general test suite.
     All commands must exit 0 for the iteration to be considered successful.
-->
```bash
# Example: node --check aigon-cli.js
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
-

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
-

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
-

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: <!-- ID and title of the research topic that spawned this feature, if any -->
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->

## Addendum 2026-04-29 — third tmux failure mode discovered

While killing the orphans we observed the actual reason `tmux not on PATH` fired during today's bench sweep: the Homebrew Cellar still contained `tmux/3.6a`, but `/opt/homebrew/bin/tmux` was a missing symlink. So `resolveTmuxBinary` correctly failed every candidate (ENOENT), but the resulting message — `"tmux is not installed or not available in PATH"` — undersold the real fix (`brew link --overwrite tmux`). Fix C should detect this case explicitly:

- If every candidate failed with ENOENT, also probe `/opt/homebrew/Cellar/tmux/*/bin/tmux` (and the equivalent `/usr/local/Cellar/tmux/*/bin/tmux` on Intel macOS). If a Cellar binary exists but the bin symlink does not, the error message should say:

  ```
  tmux is installed via Homebrew but the bin symlink is missing.
  Fix: brew link --overwrite tmux
  ```

This is the third sub-case of fix C alongside ENOENT-genuine-not-installed and EAGAIN/EMFILE-fork-starvation.
