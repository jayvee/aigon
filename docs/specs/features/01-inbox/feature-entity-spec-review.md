# Feature: entity-spec-review

## Summary
Add a cross-agent spec-review round-trip for features and research — the content-level analogue of the existing code-level `feature-review` / `feature-review-check` pair. When agent A authors a spec, the user can ask agent B to review the spec itself (not the code it describes) for specificity, completeness, testability, understandability, scope clarity, and the other attributes of a good Aigon spec. Agent B edits the spec file in place, commits with an explanatory message, and agent A then runs a corresponding check command to see what B changed and decide accept / revert / modify.

The round-trip is available for both **feature specs** and **research specs**. Four new commands ship: `feature-spec-review`, `feature-spec-review-check`, `research-spec-review`, `research-spec-review-check`. Each is invocable from the CLI, from slash commands / skills (per-agent, installed by `aigon install-agent`), and from the dashboard as a per-entity action. The review rubric is a shared checklist so both reviewers and checkers are looking at the same attributes.

Design intent: spec quality today depends on the author agent's first pass being good. This feature adds a cheap second pair of eyes from a different model/agent before anyone writes code, catching vague requirements, missing edge cases, and scope overreach at the cheapest point in the lifecycle.

## User Stories
- [ ] As a user who just had agent A author feature spec 100, I run `aigon feature-spec-review 100` (or the slash command / dashboard action) and agent B reviews the spec content, edits it in place, and commits with a "spec-review:" commit message naming what changed.
- [ ] As a user whose spec was reviewed, I run `aigon feature-spec-review-check 100` from agent A's context and see a summary of what the reviewer changed, with the option to accept (keep as-is), revert (drop B's edits), or modify (selectively keep parts).
- [ ] As a user running research, the same round-trip works: `aigon research-spec-review 42` invokes the reviewer on the research topic spec, `aigon research-spec-review-check 42` invokes the author's review of the reviewer's edits.
- [ ] As a dashboard user, a feature card (and a research card) shows a "Review spec" action when the entity is in any pre-implementation stage (inbox or backlog), and a "Check spec review" action when a prior spec-review commit exists on the spec file that hasn't been acknowledged by the author.
- [ ] As a maintainer, the review rubric used by the reviewer is editable in one place (`templates/generic/prompts/spec-review-rubric.md` or similar), not scattered across four command templates.

## Acceptance Criteria

### CLI
- [ ] `aigon feature-spec-review <ID>` exists and runs an agent-appropriate session that instructs the agent to review the feature spec at `docs/specs/features/<stage>/feature-<ID>-*.md` against a shared rubric, make edits in place, and commit with a message prefixed `spec-review: feature <ID> — <summary>`. The agent chosen is whichever is currently in the user's default reviewer slot or explicitly passed via `--agent=<id>`.
- [ ] `aigon feature-spec-review-check <ID>` runs from the author's context. It shows the user:
  - All commits on the spec file with subject matching `spec-review:` since the last `spec-review-check:` acknowledgement (or since the spec was created if none)
  - The diff of each such commit
  - A prompt for the agent to help decide accept / revert / modify per change
  - After the user decides, a commit with subject `spec-review-check: feature <ID> — <decision summary>` lands, which acts as the acknowledgement so the same reviews don't reappear on re-run
- [ ] `aigon research-spec-review <ID>` and `aigon research-spec-review-check <ID>` are the research equivalents, operating on `docs/specs/research-topics/<stage>/research-<ID>-*.md`.
- [ ] All four commands are registered in `COMMAND_REGISTRY` in `lib/templates.js` with appropriate `argHints` and short aliases (suggested: `afsr`, `afsrc`, `arsr`, `arsrc` — confirm no conflict with existing aliases before landing).
- [ ] The commands work whether the entity is in inbox (no numeric ID yet, name slug only) or in any numeric-ID stage (backlog / in-progress / in-evaluation / done). Inbox-stage invocation resolves by slug instead of numeric ID.

### Slash commands / skills (all active agents)
- [ ] `aigon install-agent` installs `feature-spec-review`, `feature-spec-review-check`, `research-spec-review`, `research-spec-review-check` as slash commands for cc/gg/cu and as skills for cx. Generated working copies live in the usual per-agent directories and are gitignored per existing pattern.
- [ ] The command templates under `templates/generic/commands/` contain a preamble that sources the shared rubric and substitutes `$ARGUMENTS`/`$1` for the entity ID. Rubric content is NOT duplicated across the four command files — it lives in one template and is included by reference or inlined at install time.
- [ ] For cx specifically, the skill body fully inlines the rubric and the step-by-step instructions (per the `agent-prompt-resolver.js` pattern already established) so cx doesn't depend on runtime skill discovery.

### Dashboard
- [ ] Dashboard feature cards expose a "Review spec" action when the feature is in inbox or backlog AND has no open spec-review cycle. The action opens a modal (similar to the existing review-agent selector) asking which agent should review.
- [ ] Dashboard feature cards expose a "Check spec review" action when there is an unacknowledged `spec-review:` commit on the spec file (i.e. `spec-review:` commits newer than the most recent `spec-review-check:` commit on that file).
- [ ] Same two actions exist on research cards.
- [ ] Both actions are defined in the central action registry (`lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js`) with `bypassMachine: true` since they don't transition workflow lifecycle. They are categorised as `INFRA` or a new `SPEC_REVIEW` category — decide based on what reads best on the dashboard.
- [ ] No action-eligibility logic lives in dashboard frontend files (per CLAUDE.md rule 8).

### Shared rubric
- [ ] `templates/generic/prompts/spec-review-rubric.md` (or similar stable path) is the single source of truth for what a reviewer looks for. Covers at minimum: specificity of acceptance criteria, testability, completeness (no open questions that block start), scope clarity (explicit out-of-scope items), dependencies named, file paths / commit refs where given are still valid, absence of vague terms ("should", "might", "flexible"), concrete examples where policy decisions were made, alignment with CLAUDE.md project conventions.
- [ ] The rubric is a living document — it can be updated without touching the four command templates, and updates flow to agents on the next `aigon install-agent` run.
- [ ] The rubric distinguishes between "must be fixed before review-check" and "nice to have" so the reviewer doesn't over-edit small-scope specs.

### Commit discipline
- [ ] Reviewer commit message format is stable and greppable: `spec-review: feature <ID> — <summary>` (and analogous for research). Format is documented in the rubric and in the command template so reviewers don't drift.
- [ ] Checker commit message format is `spec-review-check: feature <ID> — <decision>` where `<decision>` is one of `accepted`, `reverted`, `modified`, or a short free-text summary.
- [ ] If the reviewer has nothing to change (spec is already good), they emit a commit with subject `spec-review: feature <ID> — no changes (reviewed by <agent>)` that updates nothing but the review log — so the checker knows the review happened. This acts as the ack anchor.

### Test coverage
- [ ] Integration test covers the CLI round-trip with mocked agents: run `feature-spec-review <ID>` → assert a `spec-review:` commit lands with the expected format; run `feature-spec-review-check <ID>` → assert the checker sees the diff and produces the ack commit.
- [ ] Integration test covers the research equivalents with the same shape.
- [ ] Test uses the ctx dependency-injection pattern (per CLAUDE.md "The ctx Pattern" section) — no real agent processes, mocks `loadAgentConfig` and `spawn`/`spawnSync`.
- [ ] Net test-suite LOC change ≤ 0. New tests subsume or replace any overlapping coverage, or offset with deletions in the same commit. `bash scripts/check-test-budget.sh` passes. (F274 landed the suite at 1974 LOC; F276, F277, and this feature all share the same budget constraint.)
- [ ] Each new test carries a `// REGRESSION:` comment per CLAUDE.md T2, naming the specific workflow gap it prevents.

## Validation
```bash
node --check aigon-cli.js
node -c lib/templates.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/feature-workflow-rules.js
node -c lib/research-workflow-rules.js
npm test
bash scripts/check-test-budget.sh
```

Manual scenarios:
- [ ] `aigon feature-create some-name && aigon feature-spec-review some-name --agent=cc` (on an inbox item). Verify the reviewer edits the inbox spec, commits with the expected format, and `git log -- docs/specs/features/01-inbox/feature-some-name.md` shows the commit.
- [ ] Prioritise the reviewed spec, then `aigon feature-spec-review-check some-name` from a different agent. Verify the diff is shown, the agent produces a decision, and the ack commit lands.
- [ ] Repeat the scenario for research: `aigon research-create some-topic && aigon research-spec-review some-topic` → edits commit → `aigon research-spec-review-check some-topic` → ack commit.
- [ ] From the dashboard: create a feature, click "Review spec" → modal → pick an agent → tmux session spawns → reviewer commits → card now shows "Check spec review" → click it from the author's agent → decision modal → ack commit.
- [ ] With cx as the reviewer: verify the skill body is fully inlined into the launch prompt (no `$aigon-feature-spec-review` phantom) — this is the test that F277's write-path contract work must have already landed for this feature to pass cleanly.

## Technical Approach

### Command + CLI wiring
1. Register the four commands in `lib/templates.js` `COMMAND_REGISTRY` with aliases and arg hints. Verify no alias collisions before picking `afsr` / `afsrc` / `arsr` / `arsrc`.
2. Implement handlers in `lib/commands/feature.js` and `lib/commands/research.js`. Each handler:
   - Resolves the target spec file (slug lookup for inbox; spec-resolver or folder scan for numeric ID).
   - Builds the agent prompt from `templates/generic/commands/<verb>.md` + the shared rubric. For cx, inlines the full body via `agent-prompt-resolver.js` (depends on F277's mid-session helper shape — if F277 isn't done yet, duplicate the resolver logic here and plan to converge once F277 lands).
   - Spawns the agent in the current repo directory (not a worktree) since spec review happens at the main-branch level before code work starts.
   - Verifies a commit landed with the expected message format before exiting; errors with guidance if not.
3. For the `-check` commands: scan `git log -- <spec path>` for `spec-review:` commits since the most recent `spec-review-check:` commit (or since file creation). Print the diffs. Hand off to the agent to propose a decision. After agent commits the ack, exit.

### Shared rubric
4. Create `templates/generic/prompts/spec-review-rubric.md`. Authoritative checklist. Versioned with the repo.
5. Add an include/inline mechanism so the four command templates pull the rubric at install time. Simplest: `processTemplate()` or a new placeholder `{{SPEC_REVIEW_RUBRIC}}` that `lib/templates.js` resolves by reading the rubric file. Avoid runtime-fetch approaches — install-agent output should be self-contained.

### Dashboard actions
6. Add `REVIEW_SPEC` and `CHECK_SPEC_REVIEW` actions to `lib/feature-workflow-rules.js` and `lib/research-workflow-rules.js`. Eligibility:
   - `REVIEW_SPEC`: visible when entity exists and either lifecycle ∈ {inbox, backlog} OR explicit override. No active spec-review cycle pending ack.
   - `CHECK_SPEC_REVIEW`: visible when `git log` shows at least one `spec-review:` commit newer than the latest `spec-review-check:` commit for the spec file.
7. Compute both eligibility states in `lib/dashboard-status-collector.js` by reading the spec file's `git log --follow --grep='^spec-review' --format=%s <path>`. Cache per request since it's git-only.
8. Dashboard modal for "Review spec" mirrors the existing Start Autonomously modal's agent picker UI. Reuse the component, point it at the new endpoint `/api/feature-spec-review` and `/api/research-spec-review`.

### Tests
9. Use the existing `tests/integration/lifecycle.test.js` harness as a template. Mock `spawn`/`spawnSync` so the "agent" is a function that drops a pre-canned commit onto the spec file. Assert the CLI returns successfully, the commit message format is correct, and the ack flow updates the state correctly.
10. Delete at least one overlapping test to maintain net-zero LOC against the 2000 ceiling. Strong candidate: if any existing test exercises "run feature-review and assert commit" with real fixtures, subsume its assertion style into the new round-trip test.

### Execution order (by commit)
1. Shared rubric + four command templates (content only; no CLI wiring yet).
2. `COMMAND_REGISTRY` entries + CLI handler implementations for features.
3. Research equivalents.
4. Dashboard action registry entries + status collector logic.
5. Dashboard frontend: modals + card action rendering.
6. Integration tests (last so the earlier commits are exerciseable but the test commit fails until the feature is complete).

## Dependencies
- **F277 (`harden-autonomous-loop-write-paths`)** is highly desirable before this feature starts. F277 builds the inlined-skill-body mid-session helper that the review-check side of this feature also needs. Without F277, this feature will either duplicate F277's logic or ship with a less-durable prose-nudge path for cx. **Recommendation: hold start on this feature until F277 lands**, or coordinate so F277 goes first.
- `agent-prompt-resolver.js` — the canonical launch-time prompt resolver. Reused for initial reviewer launches.
- `lib/agent-registry.js` — for the capability flag F277 introduces (`slashCommandInvocable`) that determines whether cx needs inlined-body handling.
- `lib/feature-spec-resolver.js` — for resolving the spec path from a numeric ID.
- `lib/dashboard-status-collector.js` — for computing action eligibility from git log.

## Out of Scope
- Spec review of **feedback entities**. Feedback lifecycle (per F273) uses frontmatter status not git log, and feedback specs are usually shorter and less structured. If desired later, a separate feature can extend the pattern once F273 has landed and the feedback spec shape has stabilised.
- Automated spec review — no agent fires a spec review without a user initiating it from CLI / slash command / dashboard. Intentional: the value is a human-chosen second opinion, not continuous agentic chatter.
- Grading or scoring specs against the rubric ("this spec is 7/10"). The output is edits + a commit message explaining changes, not a numeric score. Numeric grading invites Goodhart's law with LLM reviewers.
- Cross-entity spec linting (e.g. "this spec references feature-246 but feature-246 isn't a thing"). Out of scope; could be a separate `aigon doctor --lint-specs` feature later.
- Changing how `feature-review` / `feature-review-check` (code review) works. Those stay as-is; this feature is strictly additive.

## Open Questions
- **Alias naming**: `afsr` etc. — need to grep `COMMAND_ALIASES` in `lib/templates.js` before landing to avoid conflicts. If collisions exist, fall back to `afsp-r`, `afsp-rc`, etc. Resolve at implementation time.
- **Inbox vs numeric ID**: should `feature-spec-review` work on inbox items (no numeric ID)? Leaning yes — catching spec quality issues *before* prioritisation is the highest-value use case. But inbox specs can be deleted by the user before prioritise, so the review commit might get orphaned. Decide on how orphan-review-commit-cleanup works, or document that spec-review on inbox items means the spec is serious enough to survive to backlog.
- **Should the reviewer be allowed to expand the spec significantly?** Versus "suggest changes, let the author incorporate them." Leaning toward "edit in place" because the round-trip is already two steps; adding a third (suggest → accept → integrate) slows the cycle. But if reviewers consistently over-edit, the rubric should add a "minimal-diff preference" rule. Observe in practice and adjust the rubric.
- **Rubric content**: what exactly goes in v1? The AC lists categories; the open question is what the concrete checklist items look like. Draft during implementation from the quality issues observed in F270, F272, F275, F276, F277 specs — all had specific failure modes worth naming.
- **Dashboard UX**: should spec-review commits show on the card as a timeline entry (like comments) so the user can see "cx reviewed on 2026-04-19, cc acknowledged on 2026-04-20" without reading git log? Probably yes for polished v2; out of scope for v1 unless it's cheap.

## Related
- `feature-review` / `feature-review-check` — the code-review pair this feature is the content-review analogue of. Same commit-driven round-trip shape; different content scope.
- Today's F270 / F272 / F275 / F276 / F277 retrospective — every one of those benefited from a human review of the spec before start. This feature institutionalises that step cheaply with a second-agent pair of eyes instead of only a human.
- `templates/generic/commands/feature-review-check.md` — reference for the commit-history-driven check workflow shape.
- `lib/agent-prompt-resolver.js` — the inlined-skill-body mechanism shared with F277.
- CLAUDE.md: "Testing Discipline" (T1/T2/T3), "The ctx Pattern", rule 8 ("Never add action buttons or eligibility logic in dashboard frontend files").
