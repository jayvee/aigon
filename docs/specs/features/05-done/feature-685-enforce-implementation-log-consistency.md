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
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-18T01:13:28.603Z", actor: "cli/feature-prioritise" }
---

# Feature: enforce-implementation-log-consistency

## Summary
Implementation logs are currently treated inconsistently across Aigon's workflow docs, generated agent instructions, `feature-do` output, and runtime gates. The docs say implementation decisions must be recorded before completion, but the default prompt/config path tells solo Drive branch agents that no log is required. Recent evidence shows closed features without logs, which loses decision context for future features. Align the logging policy, create an enforceable runtime guard where appropriate, and document a migration/backfill path for existing gaps.

## User Stories
- [ ] As an operator, I want every completed feature to have an implementation log unless I explicitly opt out, so future agents can understand decisions, deferrals, and gotchas without reconstructing history from commits.
- [ ] As an implementing agent, I want `feature-do`, generated agent docs, and workflow docs to give the same logging instruction for my mode, so I do not accidentally skip required context.
- [ ] As a maintainer, I want completion/close gates to catch missing required logs before a feature reaches `done`, so the workflow invariant is enforced by the tool and not only by prose.

## Acceptance Criteria
- [ ] The default logging policy no longer silently skips implementation logs for solo Drive branch work: with no `logging_level` set, `resolveImplementationLogVariant('drive', undefined)` returns a non-`'skip'` variant (today it returns `'skip'`; a `'minimal'` required one-liner is the minimum bar). The implementer must record the chosen default — change the product default vs. rename/repurpose `fleet-only` — in the implementation log with one line of rationale, so the resolved OQ is durable.
- [ ] `templates/generic/docs/agent.md`, `.aigon/docs/agents/*` generated content, `templates/generic/commands/feature-do.md` output, and `.aigon/docs/development_workflow.md` agree on when a log is required, optional, or explicitly disabled.
- [ ] `aigon feature-do <ID>` prints the resolved expected log path or explicit opt-out reason in all modes, and solo branch output does not contradict the workflow docs.
- [ ] When a required implementation log is missing, `aigon agent-status implementation-complete` reports it as a blocker before review, and `aigon feature-close` surfaces it through the **existing** close-integrity framework — a new gate name registered in `CLOSE_INTEGRITY_GATES` (`lib/close-integrity-policy.js`) with a label in `close-readiness.js`, advisory by default and blocking when `featureClose.integrityPolicy: "blocking"` (or a per-gate `integrityGates` override) selects it. Do not add a bespoke pass/fail check bolted onto `feature-close.js` outside that framework (avoids a second source of truth for close blocking).
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
- `lib/commands/agent-signals.js`, `lib/close-integrity-policy.js`, `lib/close-readiness.js`
  - Add a reusable helper (single source) that resolves whether a feature mode+`logging_level` requires a log and discovers the expected log file. Reuse the existing solo-vs-agent log discovery already in `agent-signals.js` (~L478–485: `feature-<ID>-*-log.md` filtered against the `feature-<ID>-<agent>-` prefix) — do not duplicate that glob.
  - Check first on `agent-status implementation-complete` so agents fix the issue before review (this is the loud, early path).
  - For the close-side safety net (explicit-arg submit, legacy sessions, dashboard close), register a new gate in `CLOSE_INTEGRITY_GATES` and emit a close finding routed through `resolveCloseIntegrityPolicy` / `isCloseFindingBlocking`, rather than a standalone check in `feature-close.js`. Advisory by default keeps existing repos unblocked while making the gap visible.
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
- Should the product default change (so no project config is needed) or should `fleet-only` be renamed/repurposed? Prefer changing the default so a fresh repo is safe out of the box; setting `"logging_level": "always"` only in this repo does not fix the invariant for users. Whichever is chosen, record it per AC #1.
- **Resolved by AC #4:** missing required logs are surfaced as a close-integrity finding governed by `featureClose.integrityPolicy` (advisory default, blocking when configured) — not a hard, unconditional `feature-close` block.
- Should `agent-status implementation-complete <ID> <agent>` explicit-arg mode remain able to bypass the log guard for recovery operations, with close as the final safety net? Default to: explicit-arg mode still warns but does not hard-block (recovery escape hatch), close is the safety net.

## Related
- Evidence: `F676` and `F677` are closed `solo_branch` features with no implementation log files.
- Related docs: `.aigon/docs/development_workflow.md`, `templates/generic/docs/agent.md`, `templates/generic/commands/feature-do.md`.
- Related code: `lib/profile-placeholders.js`, `lib/feature-do.js`, `lib/commands/agent-signals.js`, `lib/feature-close.js`, `lib/feature-command-helpers.js`.
