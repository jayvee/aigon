# Feature: check-review-skill-command

## Summary

Add an Aigon command (`feature-review-check`) that the original implementing agent runs after a reviewer has submitted fixes. It surfaces everything the reviewer changed — the `fix(review):` commits, the diff those commits introduced, and the "## Code Review" section appended to the implementation log — so the implementer can quickly understand and respond to review feedback without the user having to type the same prompt every time.

## User Stories
- [ ] As the implementing agent, after a reviewer finishes, I can run one command to see exactly what the reviewer changed and why, without asking the user for pointers.
- [ ] As the user, I don't have to manually tell the implementation agent "check the changes made by the reviewer - with details in the last commit and the log" — I just run a slash command.
- [ ] As the implementing agent, I can use the output to decide whether to accept the review, push back, or make follow-up changes before `feature-close`.

## Acceptance Criteria
- [ ] New command `aigon feature-review-check <ID>` exists and is wired up in `lib/commands/feature.js` + `lib/constants.js` COMMAND_REGISTRY.
- [ ] New template `templates/generic/commands/feature-review-check.md` drives the slash command for cc/gg/cx/cu/mv; `aigon install-agent <agent>` regenerates working copies.
- [ ] Running the command prints (in order):
  - The list of review commits on the feature branch: `git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD`
  - The cumulative diff of those commits: `git diff <first-review-commit>^..HEAD -- .` (falls back to showing each commit individually if non-contiguous)
  - The "## Code Review" section extracted from `docs/specs/features/logs/feature-<ID>-*-log.md`
- [ ] Works from both the feature worktree and from main (auto-resolves worktree path like `feature-review` does).
- [ ] If no review commits or no `## Code Review` section exists, exits 0 with a clear "No review found for feature <ID>" message (not an error).
- [ ] The `feature-review` template's Step 8 "next command" suggestion is updated to suggest `feature-review-check <ID>` for the *implementer*, keeping `feature-close` as the final step.
- [ ] Shortcut registered: `afrc` (feature-review-check) in help + skill list, consistent with existing `afr` / `afc` naming.
- [ ] `node -c aigon-cli.js` + existing tests pass.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach

**Command, not a skill.** Skills in Aigon (e.g., `frontend-design`) are heavyweight design processes. What the user is describing is a scripted lookup — exactly what Aigon slash commands are for. A slash command also benefits every agent family (cc/gg/cx/cu/mv) via the existing install pipeline, whereas skills are Claude-Code-only.

**Implementation shape** (mirrors `feature-review`):
1. `lib/commands/feature.js` — add `feature-review-check` handler:
   - Resolve feature ID via existing helpers (same argument resolution as `feature-review`).
   - Resolve worktree path via `git worktree list` + `feature-<id>-*` pattern.
   - Run the three git/log reads against the worktree using `git -C`.
   - Print a single human-readable report to stdout; no state mutation.
2. `lib/constants.js` — register in COMMAND_REGISTRY so `install-agent` picks it up.
3. `templates/generic/commands/feature-review-check.md` — thin wrapper that calls `aigon feature-review-check {{ARG1_SYNTAX}}` and instructs the agent to act on the output (decide: accept / counter / extend).
4. `templates/generic/commands/feature-review.md` — update Step 8 prompt suggestion so the reviewing agent hands off cleanly.
5. `templates/generic/commands/help.md` + skill shortcut registration — add `afrc`.

**Extracting the "## Code Review" section**: use the same markdown-section-slicing pattern already in `lib/utils.js` (spec section parsing). If more than one log file exists (multiple implementer agents in Fleet mode), iterate all of them.

**Read-only**: this command never mutates state, never signals the workflow engine, never closes anything. It's a reporting command, same category as `feature-spec` / `feature-list`.

## Dependencies
- None. Uses existing `lib/commands/feature.js`, `lib/constants.js`, install pipeline, and worktree helpers.

## Out of Scope
- Automatically acting on review feedback (applying/reverting reviewer commits).
- Any dashboard UI — this is a CLI-only command surfaced via slash command.
- A general "diff since last agent handoff" command — scope is specifically post-review handoff to the implementer.
- Turning this into a Claude skill — slash command is sufficient and cross-agent.

## Open Questions
- Should the command also signal the workflow engine (e.g., `review-acknowledged`)? Default answer: **no** — keep it pure reporting so it's safe to run multiple times and from any state.
- Should output be machine-readable (JSON) for the dashboard? Default answer: **no** — human-readable for agent consumption; revisit if the dashboard grows a "review summary" panel.
- Should `feature-close` warn if `feature-review-check` hasn't been run after a review exists? Probably not — don't add friction to a flow the user already finds smooth.

## Related
- Research:
- Related command: `feature-review` (the command this one complements)
- Related spec: feature 221/222 (pro-autonomy-gate) — autonomous flow already handles review-complete → close, but this command is for the manual Drive-mode case where the user wants the implementer to look at review changes.
