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
  - { from: "inbox", to: "backlog", at: "2026-06-18T04:15:49.896Z", actor: "cli/feature-prioritise" }
---

# Feature: fix-security-scan-feature-filing

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary

Fix aigon security-scan follow-up feature filing so HIGH findings are created, prioritised into backlog, and reported with real feature IDs instead of feature-null; the 2026-06-18 scan created inbox specs but failed the prioritise/reporting path.

## User Stories
<!-- Specific, stories describing what the user is trying to acheive -->
- [ ] As an operator running `aigon security-scan`, I want each actionable HIGH survivor to become a normal backlog feature automatically so remediation work enters the standard feature lifecycle without manual filing.
- [ ] As an operator reading scan output, I want the command to print the real `feature-<id>` that was filed, or a concrete failure reason, so I can trust the scan digest and follow up on the correct spec.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] When `lib/commands/security-scan.js` processes a HIGH finding that is not already filed, it creates exactly one feature via `aigon feature-create`, prioritises that same feature via `aigon feature-prioritise`, and leaves the resulting spec only at `docs/specs/features/02-backlog/feature-<id>-<slug>.md` with a numeric ID in the filename. The command output prints `feature-<id>` and never prints `feature-null`.
- [ ] If follow-up filing cannot complete after the feature-create step (for example, prioritise fails or the created spec cannot be re-located), `aigon security-scan` does not report a successful created feature ID. It must emit a concrete warning/error for that finding that includes the failing step, so the operator is not misled by a false success line.
- [ ] Duplicate HIGH findings continue to de-duplicate through the existing fingerprint/slug logic across feature stages. When a duplicate is detected, the scan prints a skip message that includes the existing numeric feature ID when the matching spec is already prioritised.
- [ ] Regression coverage exercises the 2026-06-18 failure mode end-to-end at the command/helper boundary: one test proves a HIGH finding becomes a backlog spec with a numeric ID, and one test proves the failure path never reports `feature-null` or a created ID after a prioritise/re-locate failure.

## Validation
<!-- Optional: commands the iterate loop runs after each iteration (in addition to project-level validation).
     Use for feature-specific checks that don't fit in the project's general checks.
     All commands must exit 0 for the iteration to be considered successful.
     Leave the block below empty or remove it if there is nothing feature-specific to run. -->
```bash
node scripts/run-tests-parallel.js "tests/unit/*security-scan*.test.js"
node scripts/run-tests-parallel.js "tests/integration/*security-scan*.test.js"
```

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->
- Keep the fix in the CLI/security-scan layer, centred on `lib/commands/security-scan.js`; do not introduce dashboard-only repair logic or a second source of truth for filed follow-up features.
- Tighten `createFeatureForFinding()` so creation, prioritisation, and final ID/path resolution are treated as distinct steps with explicit success/failure handling. The implementation should preserve the current duplicate-detection intent (`findExistingFeatureForFinding`) but make the reported feature ID come from a verified prioritised spec, not from an unchecked/null intermediate value.
- Preserve the existing auto-filing policy for HIGH findings from `.scan/reports/2026-06-18.md`: this feature fixes the filing pipeline and reporting semantics, not the triage rules or severity thresholds.
- Prefer a focused regression test seam around `createFeatureForFinding()` / `runAigonCommand()` behavior rather than expanding scope into scanner-runner coverage for gitleaks, semgrep, osv-scanner, or npm-audit.

## Dependencies
<!-- Other features, external services, or prerequisites.
     For Aigon feature dependencies use: depends_on: feature-name-slug
     This enables ordering enforcement — dependent features can't start until deps are done. -->
- None beyond the existing `security-scan` command and test harness.

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- Changing how findings are triaged, suppressed, or ranked.
- Rewriting the scanner runners under `lib/security-scan/runners/`.
- Creating follow-up features for MEDIUM/LOW findings or changing the recurring security-scan policy.

## Open Questions
<!-- Unresolved questions that may need clarification during implementation -->
- Should the failure path leave the created inbox spec in place for manual recovery, or should the implementation attempt cleanup when prioritisation fails? The spec should keep the first implementation pass conservative unless cleanup can be made atomic.

## Related
<!-- Links to research topics, other features, or external docs -->
- Research: none linked
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->
