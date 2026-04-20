# Feature: implementation-log-mode-conditional

## Summary
Implementation logs (`docs/specs/features/logs/feature-<ID>-<agent>-<desc>-log.md`) are currently required by the agent prompt template in all modes — Drive branch, Drive worktree, and Fleet — with the same full-verbosity template asking for "key decisions, summary of the conversation, issues encountered, approach and rationale." In most modes this produces dead-weight content that nobody reads: the spec restates itself, the commit history covers "what happened", and the user already saw the conversation live. In Fleet mode, by contrast, a short log per agent is genuinely useful to the evaluator comparing approaches side-by-side.

Feature `a092ef27` (just landed) trimmed the template's verbosity, but still asks for a log in every mode. This feature goes one step further: make log writing **mode-conditional** so agents only write a log when it will actually be read, and when they do, the template forces the content to earn its place.

## Desired Outcome
**Every line written into an implementation log must be worth the tokens it cost to write it.**

Concretely, that means:
- In modes where no human or downstream agent will read the log, no log is written. Zero tokens spent.
- In modes where the log IS read (primarily Fleet-mode evaluation, and occasionally solo debugging), the log contains only content that cannot be derived from the spec, the commit history, or the code itself.
- Agents stop spending 5–15 minutes per feature on log prose that duplicates other sources of truth.
- Reviewers/evaluators can trust that if a log exists, it's saying something the other artifacts don't.

Success looks like: a Fleet-mode evaluator reads three 5-to-10-line logs in a minute and walks away with a concrete sense of how each agent differed in approach. A solo Drive-mode feature closes with no log file, and nothing is lost.

## User Stories
- [ ] As a solo Drive-mode user, when I run `aigon feature-do <ID>` and finish quickly, the agent does not waste tokens writing an implementation log whose content is already in the spec and commits.
- [ ] As a Fleet-mode evaluator running `aigon feature-eval <ID>`, I can read one short, focused log per agent that tells me how their approach differed — no preamble, no spec restatement, no conversation transcript.
- [ ] As an agent, my instructions make it clear when a log is required (Fleet) versus skipped (solo) versus optional (worktree solo), so I don't over-invest in prose that won't be read.
- [ ] As a repo maintainer configuring Aigon for my project, I can set a global `logging_level` in `.aigon/config.json` to override the default per-mode behaviour (e.g., "always write a log" for audit-heavy projects, or "never" for speed-first ones).

## Acceptance Criteria
- [ ] The feature prompt template (`templates/generic/commands/feature-do.md` via `LOGGING_SECTION`) branches on mode: Fleet requires a short log; solo worktree offers an optional log; Drive (branch) skips the log step entirely.
- [ ] Mode detection happens at template-resolution time (`lib/profile-placeholders.js`) using information already available to the prompt resolver (branch name / worktree path / `mode` field).
- [ ] A repo-level override in `.aigon/config.json` (`{"logging_level": "fleet-only" | "always" | "never"}`) takes precedence over the mode-based default.
- [ ] When a log is NOT required, the agent is explicitly told so — "no log needed in this mode; the spec and commits are the record". No ambiguous "optional" wording that causes agents to write one anyway out of caution.
- [ ] When a log IS required, the template enforces a content shape: max 10 lines, 3–5 bullets, explicit "do NOT include" list (already added in `a092ef27`), and asks for content that is NOT derivable from spec/code/commits.
- [ ] `lib/worktree.js:1303` log template scaffolding only writes a starter log file when the mode calls for one. In skip modes, no `feature-<ID>-<agent>-log.md` file is created.
- [ ] `feature-eval` / `feature-close` don't assume a log exists. Missing logs in skip modes are not errors.
- [ ] Regression test: for each mode (drive-branch, drive-worktree, fleet), verify the correct `LOGGING_SECTION` variant is injected and the log file is created (or not) accordingly.
- [ ] Documentation updated: `docs/agents/*.md` and `docs/development_workflow.md` explain the new mode-conditional behaviour and the config override.

## Validation
```bash
node -c lib/profile-placeholders.js
node -c lib/worktree.js
node -c lib/agent-prompt-resolver.js
npm test
bash scripts/check-test-budget.sh
```

## Technical Approach

### Where logs earn their keep (keep these)
- **Fleet-mode evaluator** — reading 3 short logs side-by-side is faster than diffing 3 branches to infer approach differences. Strongest single argument for keeping logs at all.
- **Mid-flight debugging** — when a feature stalls and the user attaches to a worktree, a short log tells them what the agent was trying to do, which commits alone don't always make clear.
- **Post-mortem on a bad feature** — occasionally useful, especially for non-obvious architectural choices.

### Where logs are dead weight (skip these)
- **Solo Drive-branch mode** — one agent, one branch on main, small scope. Log restates the spec and narrates what the commits already show. Nobody re-reads it.
- **"Future context for new agents"** — agents don't read closed-feature logs. The spec + code is ground truth. Closed logs are folder noise.
- **Conversation summaries** — regenerate prose the user already saw live. Already removed from the template in `a092ef27`, but the underlying habit persists unless we stop asking for logs at all in modes where summaries are the bulk of what gets written.

### Where logs are actively harmful
- Any prompt section asking for narrative prose burns 5–15 minutes of model thinking every feature. Observed live on F282 (cx sat in "Considering update logs" for ~12 min after validation was green), F283 (same pattern), F284 (same). At scale, that's >1 hour per day on writing content nobody reads.
- The current prompt makes logs feel mandatory even when the user would skip them — agents over-invest out of caution.

### Proposed design

**Three logging levels driven by mode + optional config override:**

| Mode | Default | Rationale |
|------|---------|-----------|
| Drive (branch, solo) | `skip` | Commit history + spec fully cover this. Log adds no signal. |
| Drive (worktree, solo) | `minimal` (one-line) | User may want the post-mortem breadcrumb but doesn't need prose. |
| Fleet (2+ agents) | `fleet` (short — 3–5 bullets, focus on approach differences) | Evaluator actually reads it; comparison is the value. |

**Config override in `.aigon/config.json`:**
```json
{ "logging_level": "fleet-only" }  // default
{ "logging_level": "always" }       // audit-heavy repos
{ "logging_level": "never" }        // speed-first repos
```

**Template changes:**
- `lib/profile-placeholders.js` `resolveLoggingPlaceholders` already supports `full` / `minimal` / `skip`. Extend to understand mode — take a `mode` argument in addition to `loggingLevel`.
- Add a new `FLEET_LOGGING` constant that replaces `FULL_LOGGING` for Fleet mode. Content: 3–5 bullets focused on "what my approach differs from the obvious reading of the spec", plus the existing "do NOT include" list.
- When `LOGGING_SECTION` resolves to empty (skip mode), insert a one-line explicit statement: "No log is required in this mode — the spec and commits are the record. Proceed directly to Step 5 (submit)." This prevents agents from writing one anyway.
- Worktree setup (`lib/worktree.js:1303`) conditionally writes the starter log file based on mode.

**Mode detection:**
- `mode` is already known at prompt-resolution time via `lib/agent-prompt-resolver.js` / worktree setup. Pass it through to `resolveLoggingPlaceholders`.
- For Drive (branch) the mode signal is "no worktree, no `-<agent>-` in branch name". For Fleet, it's "multiple agents started via `feature-start`". For Drive worktree, it's "single agent, worktree exists".

**Backwards compatibility:**
- Existing log files in `docs/specs/features/logs/` are left alone. `feature-close` / `feature-eval` tolerate both presence and absence.
- The CLI config field is new; absence means "use the new defaults". No migration needed.

## Dependencies
- Soft: `feature-rethink-spec-review-workflow-state` (F283) has overlapping surface area if it touches the `LOGGING_SECTION` resolver. Not a hard block.
- None hard.

## Out of Scope
- Rewriting the log file *format* (markdown structure, headers, etc.). This feature changes WHEN logs are written, not how they're rendered.
- Research-topic logs (`docs/specs/research-topics/logs/`). Research findings serve a different purpose (the deliverable IS the log) and should stay required.
- Stripping the "Decisions" / "Progress" scaffolding from the starter log file. If logs are required in a mode, the scaffolding can stay; if skipped, no file is written at all.
- Agent-specific overrides (cx-only, cc-only). Mode is the right axis — if a mode's log is valuable, it's valuable regardless of which agent writes it.

## Open Questions
- Is `drive-worktree` solo really worth a one-line log, or should it default to `skip` too? (Lean: one-line. The breadcrumb is cheap and useful mid-flight.)
- Should the config field live in global `~/.aigon/config.json`, project `.aigon/config.json`, or both? (Lean: project-level, since different repos have different audit needs.)
- When the log is `fleet-only` and a user later runs `feature-eval` on a feature that was originally solo-Drive, the logs don't exist. Should `feature-eval` fall back to diffs, or tell the user to re-run with a logging override? (Lean: fall back to diffs with a notice.)
- Do we measure the impact? (Lean: yes — add a one-time telemetry event `log_skipped_mode_<X>` to the stats pipeline so we can confirm tokens saved per week.)

## Related
- Preceded by: commit `a092ef27` (feat(templates): tighten submit timing and log brevity) — same-day tightening that kept logs in all modes but cut their verbosity.
- Triggered by: observed behaviour on F282/F283/F284 — cx sessions sat 9–12 minutes each "considering update logs" after validation was green. Three features × one agent each × ~10 min each = ~30 min of wall-clock + model cost per day spent writing content that wouldn't be read.
- Related memory: `feedback_verify_before_claiming_broken.md` — encourages verifying assumptions before implementing. Before landing this feature, grep closed-feature logs in this repo and count how many are ever re-referenced by a subsequent feature (prediction: very few outside Fleet eval).
- CLAUDE.md § Reading Order — lists spec files and agent docs, not feature logs, as the canonical reading order for orientation. Reinforces the view that closed logs are not part of the "future agent context" pipeline.
