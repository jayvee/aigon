# Feature: check-review-skill-command

## Summary

Add a prompting-shortcut slash command (`/aigon:feature-review-check`) that the **implementation agent** runs inside its own session after a reviewer finishes. The command expands to a pre-written prompt telling the agent to read the reviewer's commits and log entry, then decide whether to **accept**, **challenge**, or **modify** the review. It's a prompt template, not a new CLI command — no Aigon code, no state, no engine signals.

## User Stories
- [ ] As the user, I can type `/afrc` in the implementation agent's session instead of re-typing "check the changes made by the reviewer — details in the last commit and log" every time.
- [ ] As the implementing agent, the slash command gives me a clear, consistent instruction: read review commits, read review log entry, then decide accept/challenge/modify and act accordingly.
- [ ] As the user, the shortcut works across cc/gg/cx/cu/mv because it goes through the standard `install-agent` pipeline.

## Acceptance Criteria
- [ ] New template file `templates/generic/commands/feature-review-check.md` exists, containing the agent-facing prompt (no CLI invocation required).
- [ ] The template instructs the agent to:
  1. Find the reviewer's commits: `git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD`
  2. Read the cumulative diff of those commits.
  3. Read the `## Code Review` section appended to `docs/specs/features/logs/feature-<ID>-*-log.md`.
  4. Decide one of: **accept** (no action), **challenge** (explain disagreement to the user and stop), **modify** (make follow-up commits, then stop).
  5. Report the decision and a brief summary back to the user.
- [ ] Template registered in the command registry so `aigon install-agent <agent>` generates working copies for cc/gg/cx/cu/mv.
- [ ] Shortcut registered: `afrc` → `feature-review-check`, consistent with existing `afr`/`afc` naming. Added to `help.md` and the skill shortcut list.
- [ ] `feature-review.md` Step 8 updated so the reviewing agent's "next command" suggestion points the user at `/aigon:feature-review-check <ID>` for the implementer (keeping `feature-close` as the final step after the implementer decides).
- [ ] Running `aigon install-agent cc` regenerates `.claude/commands/aigon/feature-review-check.md` cleanly.
- [ ] `node -c aigon-cli.js` passes; existing tests pass.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach

**This is a prompt template, not code.** The feature ships as a single markdown template under `templates/generic/commands/` plus registry/help updates. No handler in `lib/commands/feature.js`, no new CLI verb, no engine integration.

**Files touched:**
1. `templates/generic/commands/feature-review-check.md` — **new**. The full agent-facing prompt. Uses existing `{{ARG1_SYNTAX}}` / `{{CMD_PREFIX}}` placeholders the install pipeline already handles.
2. `lib/templates.js` (COMMAND_REGISTRY) or `lib/constants.js` — **one-line addition** registering the new template so `install-agent` picks it up for every agent family.
3. `templates/generic/commands/help.md` — add `afrc` to the shortcut list.
4. Any skill/shortcut definition file consumed by `install-agent` for cc — add `afrc` entry (mirrors how `afr` is defined).
5. `templates/generic/commands/feature-review.md` — update Step 8 prompt suggestion so the reviewing agent, on completion, tells the user to run `/aigon:feature-review-check <ID>` in the implementer's session before `/aigon:feature-close`.

**Template content outline** (for the spec, not final prose):

```markdown
<!-- description: Check the review just done on feature <ID> and decide accept/challenge/modify -->
# aigon-feature-review-check

A reviewing agent has just committed fixes (or notes) on this feature branch.
Your job is to check what the reviewer did, then decide how to respond.

## Step 1: Find the review commits
Run: `git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD`

## Step 2: Read the diff
For each review commit, run `git show <sha>` and understand the change.

## Step 3: Read the review notes
Open `docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md` and read the
`## Code Review` section.

## Step 4: Decide
Pick ONE:
- **Accept** — the review is correct. Do nothing. Tell the user "Review accepted."
- **Challenge** — you disagree with one or more fixes. STOP, explain your
  reasoning to the user, and wait for their decision. Do NOT revert commits.
- **Modify** — the review is mostly right but needs follow-up changes. Make
  minimal edits, commit with `fix(post-review): ...`, then tell the user.

## Step 5: Report
Tell the user:
- Which option you chose
- One-line summary per review commit
- Any open questions

Do NOT run `feature-close`. The user decides when to close.
```

**Why this is a command, not a Claude skill:** skills are Claude-Code-only and heavyweight. Slash commands install into every agent family via the existing pipeline and are the right tool for lightweight prompting shortcuts like this one. This matches the pattern of every other `feature-*` command in `templates/generic/commands/`.

## Dependencies
- None. Uses the existing `install-agent` template pipeline and registry.

## Out of Scope
- Any new `aigon` CLI verb or `lib/commands/feature.js` handler.
- Any workflow-engine signal (e.g., "review-acknowledged") — this is purely a prompting shortcut.
- A Claude skill version — slash command is sufficient and cross-agent.
- Automatic accept/reject logic — the agent decides, the user confirms.
- Dashboard UI changes.

## Open Questions
- Should the template instruct the agent to run `git log main..HEAD` unfiltered (to also see its own pre-review commits for context)? Leaning **yes** — one extra line, useful context.
- Should `--modify` follow-up commits use `fix(post-review):` or just `fix:`? Leaning `fix(post-review):` to keep the audit trail clear alongside `fix(review):`.
- Is `afrc` the right shortcut? `afr` is already `feature-review`; `afrc` reads as "feature-review-check". Alternative: `afrk` (feature-review-check-k? no). Sticking with `afrc`.

## Related
- Research:
- Related command: `feature-review` (this command is the implementer-side counterpart to the reviewer-side `feature-review`)
- Related feedback: "Never break the solo worktree review flow" — this feature extends that flow without mutating it
