---
aigon_id: F685
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
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: enforce-implementation-log-consistency

## Summary
Implementation logs are currently treated inconsistently across Aigon's workflow docs, generated agent instructions, `feature-do` output, and runtime gates. The docs say implementation decisions must be recorded before completion, but the default prompt/config path tells solo Drive branch agents that no log is required. Recent evidence shows closed features without logs, which loses decision context for future features. Align the logging policy, create an enforceable runtime guard where appropriate, and document a migration/backfill path for existing gaps.

## User Stories
- [ ] As an operator, I want every completed feature to have an implementation log unless I explicitly opt out, so future agents can understand decisions, deferrals, and gotchas without reconstructing history from commits.
- [ ] As an implementing agent, I want `feature-do`, generated agent docs, and workflow docs to give the same logging instruction for my mode, so I do not accidentally skip required context.
- [ ] As a maintainer, I want completion/close gates to catch missing required logs before a feature reaches `done`, so the workflow invariant is enforced by the tool and not only by prose.

## Acceptance Criteria
- [ ] The default logging policy no longer silently skips implementation logs for solo Drive branch work. If the chosen product decision is not "always", the alternative must still preserve a durable feature-level context artifact by default.
- [ ] `templates/generic/docs/agent.md`, `.aigon/docs/agents/*` generated content, `templates/generic/commands/feature-do.md` output, and `.aigon/docs/development_workflow.md` agree on when a log is required, optional, or explicitly disabled.
- [ ] `aigon feature-do <ID>` prints the resolved expected log path or explicit opt-out reason in all modes, and solo branch output does not contradict the workflow docs.
- [ ] `aigon agent-status implementation-complete` or `aigon feature-close` blocks, or at minimum emits a clear non-bypassable warning under the selected policy, when a required implementation log is missing.
- [ ] The guard respects an explicit project opt-out such as `"logging_level": "never"` and does not require logs for research findings or unrelated docs/state files.
- [ ] Existing feature log discovery remains compatible with both solo names (`feature-<ID>-<desc>-log.md`) and agent-specific names (`feature-<ID>-<agent>-<desc>-log.md`).
- [ ] Focused regression coverage proves that the default policy requires a solo branch log, that explicit opt-out still skips, and that completion/close handling detects a missing required log.
- [ ] Add or update operator-facing guidance for backfilling missing logs, including the known local examples `F676` and `F677`.

## Validation
```bash
npm run test:iterate
node scripts/check-template-leaks.js
```

## Pre-authorised

## Technical Approach
Investigation context:

- The workflow docs currently state that implementation decisions must be documented in `logs/` before completing and the solo workflow step says to update `./docs/specs/features/logs/`.
- Generated agent docs currently say: "Implementation Log: Mode-conditional - Fleet requires a short log; solo Drive (branch) skips it by default; solo Drive worktree uses a one-line log when a starter file exists."
- Recent closed features `F676` and `F677` are `solo_branch` and have no matching `docs/specs/features/logs/feature-676-*.md` or `feature-677-*.md` files.
- Their workflow event streams include `feature.closed`; their close commits are named "move spec and logs" but only rename the spec file.
- Recent `solo_worktree` features such as `F674`, `F675`, and `F678`-`F683` do have agent-specific log files, which points to a mode-policy gap rather than random agent noncompliance.

Likely implementation areas:

- `lib/profile-placeholders.js`
  - Review `normalizeProjectLoggingLevel`, `resolveImplementationLogVariant`, `LOGGING_NO_FILE_LINE`, and related logging sections.
  - Decide whether the default should become `always`, or whether `fleet-only` should be renamed/reworked so solo branch gets a concise required log by default.
  - Keep explicit `"logging_level": "never"` as a supported opt-out.
- `lib/feature-start.js` / `lib/commands/feature.js`
  - Ensure starter log creation matches the selected default policy for solo branch and worktree modes.
- `lib/feature-do.js`
  - Update the "Log:" and "Next Steps" output so agents see the correct required path and cannot be told to skip a required log.
- `templates/generic/docs/agent.md` and installed `.aigon/docs/agents/*.md`
  - Align persistent agent guidance with runtime behavior. Avoid target-repo-specific assumptions.
- `templates/docs/development_workflow.md` and `.aigon/docs/development_workflow.md`
  - Clarify that logs are default-required feature context, with explicit opt-out only through config.
- `lib/commands/agent-signals.js` and/or `lib/feature-close.js`
  - Add a reusable helper that resolves whether a feature mode requires a log, discovers the expected log file, and reports a precise error/warning.
  - Prefer checking on `agent-status implementation-complete` so agents fix the issue before review. Add a close-side safety check if the submit path can be bypassed through explicit args, legacy sessions, or dashboard close.
- `lib/feature-command-helpers.js`
  - Keep logs ignored for "substantive implementation evidence"; that prevents log-only submissions from passing. Add separate log-required evidence rather than conflating the two.

Testing plan:

- Extend or add focused tests around `resolveImplementationLogVariant` and `shouldWriteImplementationLogStarter` for solo branch defaults and explicit opt-out.
- Add a command-level regression test for missing required logs at completion or close, using a temporary repo fixture and a minimal feature branch where possible.
- Include `// REGRESSION:` comments per `docs/testing.md`.
- Run `npm run test:iterate`; run `node scripts/check-template-leaks.js` because templates change.

## Dependencies
- None.

## Out of Scope
- Do not redesign the entire feature lifecycle or add new workflow states.
- Do not change research findings behavior except to avoid accidental feature-log checks on research commands.
- Do not require long narrative logs for every tiny feature; concise logs are acceptable if the invariant is durable context.
- Do not backfill all historical missing logs automatically. Document the approach and optionally backfill only known local examples if the implementation agent judges it safe.

## Open Questions
- Should this repo set `"logging_level": "always"` explicitly, or should the product default change so no project config is needed?
- Should missing required logs block `feature-close`, or should close record a blocking/advisory integrity finding based on `featureClose.integrityPolicy`?
- Should `agent-status implementation-complete <ID> <agent>` explicit-arg mode remain able to bypass the log guard for recovery operations, with close as the final safety net?

## Related
- Evidence: `F676` and `F677` are closed `solo_branch` features with no implementation log files.
- Related docs: `.aigon/docs/development_workflow.md`, `templates/generic/docs/agent.md`, `templates/generic/commands/feature-do.md`.
- Related code: `lib/profile-placeholders.js`, `lib/feature-do.js`, `lib/commands/agent-signals.js`, `lib/feature-close.js`, `lib/feature-command-helpers.js`.
