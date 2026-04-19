# Feature: review-spec

## Summary
A back-and-forth review of a spec by one or more agents before implementation starts often surfaces gaps (missing acceptance criteria, ambiguous scope, wrong technical approach) that are expensive to fix once code is being written. Today Aigon has no first-class way to do this — you either paste the spec into another chat manually or spin up a worktree and use `feature-review`, which is designed to review implementation code, not the spec. This feature adds a dedicated "review the spec" action, invokable from both a slash command and the dashboard, that launches a chosen agent with a review-oriented prompt against a feature or research spec file and captures the agent's feedback where the user can act on it.

## User Stories
- [ ] As a user with a feature in backlog, I can run `/aigon:feature-review-spec <id> <agent>` and have that agent read the spec and write a review (strengths, gaps, risky decisions, suggested edits) without moving the feature out of backlog or creating a worktree.
- [ ] As a user with a research topic, I can do the same with `/aigon:research-review-spec <id> <agent>` against the research spec.
- [ ] As a user viewing a feature card on the dashboard (in inbox or backlog), I can click a "Review spec" button, pick an agent, and have the same flow run without leaving the dashboard.
- [ ] As a user who wants multiple opinions, I can run `review-spec` more than once on the same spec with different agents and see each agent's review separately.
- [ ] As a user, after the review finishes I can read the agent's suggestions and decide which to fold into the spec manually (or ask another agent to edit the spec directly) — the feature does not edit the spec file itself.

## Acceptance Criteria
- [ ] `aigon feature-review-spec <id> <agent>` CLI command exists; works on specs in `01-inbox/` and `02-backlog/` (does not require the feature to be started).
- [ ] `aigon research-review-spec <id> <agent>` equivalent exists for research topics.
- [ ] Both commands launch the agent against the current spec file in the main checkout (no worktree, no branch) — matches the precedent set by `research-do`.
- [ ] Agent receives a review-oriented prompt that instructs it to read the spec and produce a structured review covering at minimum: summary of the spec in its own words, strengths, gaps / missing detail, risky technical decisions, suggested edits. The exact prompt lives in `templates/generic/commands/feature-review-spec.md` and `research-review-spec.md`.
- [ ] Review output is written to a predictable, per-run location (e.g. `.aigon/workflows/features/<id>/spec-reviews/<timestamp>-<agent>.md`) so multiple reviews accumulate and are discoverable from both CLI and dashboard.
- [ ] Dashboard surfaces a "Review spec" action on feature and research cards while the spec is in inbox or backlog. The action is defined in `lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js` as an **infra action** (`bypassMachine: true`, category `INFRA`) — no frontend-side eligibility logic.
- [ ] Dashboard shows an indicator on the card when one or more spec reviews exist, with a way to open / list them.
- [ ] The feature does not change the card's workflow state. Running `review-spec` leaves a feature in backlog (or wherever it was); it is a pre-implementation aid, not a lifecycle step.
- [ ] Shell-trap signal wrapper runs for the launched agent so the session completes cleanly and emits an `agent-status` signal on exit (does not pollute feature lifecycle — the signal is routed to a spec-review completion, not `submitted`).
- [ ] Running `review-spec` on a spec that doesn't exist, or with an agent that isn't installed, fails cleanly with a helpful message.
- [ ] The new verb `review-spec` is wired through `lib/agent-prompt-resolver.js` so cx (inlined template), cc, and gg all launch correctly.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
**Reuse the `research-do` pattern, not the `feature-review` pattern.** `research-do` already runs an agent against a spec file in the main checkout with no worktree; this is the precedent for spec-review. `feature-review` reviews implementation code in a worktree and should stay unchanged.

**Core pieces:**
1. **New verb `review-spec`** in `lib/agent-prompt-resolver.js` — add to `VERB_TO_PROMPT_FIELD` (`review-spec` → `reviewSpecPrompt`) and `VERB_TO_TEMPLATE` (`review-spec` → `feature-review-spec` / `research-review-spec`). Add `reviewSpecPrompt` to relevant agent JSON files in `templates/agents/`.
2. **New templates**: `templates/generic/commands/feature-review-spec.md` and `research-review-spec.md`, each with the review-oriented prompt body. Slash commands `/aigon:feature-review-spec` and `/aigon:research-review-spec` are generated from these via `install-agent`.
3. **New CLI handlers** in `lib/commands/feature.js` and `lib/commands/research.js` — resolve the spec path (via `lib/feature-spec-resolver.js` for features), build the agent command with `buildAgentCommand()`, launch without a worktree (cwd = main checkout). Output destination is passed to the agent as an explicit path to write to.
4. **Review storage**: `.aigon/workflows/{features,research}/<id>/spec-reviews/<ISO-timestamp>-<agentId>.md`. Directory is created lazily. Multiple reviews per spec are expected and kept side by side.
5. **Infra action** in `lib/feature-workflow-rules.js` and `lib/research-workflow-rules.js`: `REVIEW_SPEC` candidate with `bypassMachine: true`, `category: ActionCategory.INFRA`, `guard: spec is in inbox | backlog` (and for research, any pre-in-progress state). Requires agent input (reuse the same "pick an agent" pattern used elsewhere, e.g. `feature-review`).
6. **Dashboard**: `lib/dashboard-status-collector.js` includes spec-review count per card; `templates/dashboard/js/actions.js` / `pipeline.js` render the button from `validActions` (no new hardcoded frontend logic). A click opens the same agent picker used by `feature-review`.
7. **Shell trap**: extend `buildAgentCommand`'s `task` parameter to accept `review-spec`; on clean exit emit a dedicated `agent-status spec-review-complete` signal (or reuse the review-complete signal, scoped to not touch feature workflow state).

**Non-functional:**
- Must be cheap to launch — no worktree, no branch creation, no tmux-only-on-terminal-adapter gymnastics. Same terminal adapter flow as `research-do`.
- Must work with cx (codex) — template must inline cleanly through `lib/agent-prompt-resolver.js`'s cx path.
- Must not mutate the spec file. The agent writes its review to the reviews dir and, if it wants to propose edits, writes them as suggested diffs in the review markdown.

## Dependencies
- None — builds entirely on existing primitives (`buildAgentCommand`, `agent-prompt-resolver`, workflow rules, action registry, dashboard renderer).

## Out of Scope
- Editing the spec file on the user's behalf. The agent produces feedback; applying it is a separate step the user drives (manually or via a follow-up agent invocation).
- Multi-agent coordinated debate / back-and-forth in a single run. v1 is "one agent, one review, repeat as needed." Structured multi-agent critique (agent A reviews, agent B critiques A's review) is a plausible v2 but not this feature.
- Auto-triggering on spec creation or prioritise. The user explicitly invokes `review-spec` when they want it.
- Feedback-entity spec review. Feedback items don't have the same spec-heavy lifecycle as features/research; adding it there is deferrable.
- Changing how `feature-review` works. That command continues to review implementation code in a worktree.

## Open Questions
- **Worktree or not?** Current leaning: **no worktree**, matching `research-do`. A worktree would only be useful if the reviewing agent needs to propose and commit spec edits, which is out of scope for v1. Confirm during implementation that there is no hidden reason (e.g. agent tooling assumptions) that forces a worktree.
- **Where does the agent write its output?** Proposed: `.aigon/workflows/<kind>/<id>/spec-reviews/<timestamp>-<agent>.md`. Alternative: alongside the spec in `docs/specs/**/reviews/`. Engine-state dir keeps review artefacts out of git by default (gitignored), which is probably right — reviews are transient artefacts, not historical record. Confirm.
- **Signal routing.** The shell trap currently emits `submitted` / `reviewing` / `review-complete` / `error`. A spec-review completion should NOT be routed to the feature workflow machine (spec-review doesn't change state). Simplest answer: new signal `spec-review-complete` that the agent-status handler ignores for workflow transitions but uses to close the tmux session cleanly.
- **Agent selection in dashboard.** Reuse the existing agent-picker UI from `feature-review`? Likely yes — don't invent a new one.
- **Rate limiting / dedup.** Should we block a second review while one is in flight for the same spec+agent? Or allow parallel reviews? Default: allow parallel — reviews are idempotent and users may genuinely want overlapping opinions.
- **Research has fewer lifecycle states than features.** Does the "inbox or backlog only" guard make sense for research, or should spec-review be available in any pre-in-progress state? Likely the latter.

## Related
- Research:
- `feature-review` (reviews implementation code, different lifecycle)
- `research-do` (precedent for no-worktree spec-reading agent)
- `lib/agent-prompt-resolver.js` — verb → prompt mapping
- `lib/feature-workflow-rules.js` / `lib/research-workflow-rules.js` — action registry
