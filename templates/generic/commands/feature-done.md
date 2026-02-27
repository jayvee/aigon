<!-- description: Complete feature <ID> [agent] [--adopt] - merges branch, cleans up, optionally adopts from losers -->
# aigon-feature-done

Complete a feature by merging the implementation and cleaning up.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing feature:
1. List all files in `./docs/specs/features/03-in-progress/` and `./docs/specs/features/04-in-evaluation/` matching `feature-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching features and ask the user to choose one

## Usage

### Solo mode (branch or worktree)
If you used `feature-setup {{ARG1_SYNTAX}}` or `feature-setup {{ARG1_SYNTAX}} <agent>`:
```bash
aigon feature-done {{ARG1_SYNTAX}}
```
The command auto-detects whether the feature uses a branch or a solo worktree.

### Arena mode
If you used `feature-setup {{ARG1_SYNTAX}} cc gg cx cu`:
```bash
aigon feature-done {{ARG1_SYNTAX}} <winning-agent>
```

Example: `aigon feature-done {{ARG1_SYNTAX}} cc` to merge Claude's implementation

### Arena mode with adoption
Merge the winner and print diffs from losing agents for selective adoption:
```bash
aigon feature-done {{ARG1_SYNTAX}} <winning-agent> --adopt <agents...|all>
```

Examples:
- `aigon feature-done {{ARG1_SYNTAX}} cc --adopt gg cu` — adopt from specific agents
- `aigon feature-done {{ARG1_SYNTAX}} cc --adopt all` — adopt from all losing agents

## What happens

### Solo Mode

1. Pushes the feature branch to origin (to save work remotely)
2. Switches to main/master branch
3. Merges the feature branch with `--no-ff`
4. Moves spec to `05-done/`
5. Moves implementation log to `logs/selected/`
6. Deletes the local feature branch
7. Commits the spec and log moves

### Arena Mode

1. Pushes the winning agent's branch to origin
2. Switches to main/master branch
3. Merges the winning agent's branch with `--no-ff`
4. Moves spec to `05-done/`
5. Organizes logs:
   - Winning agent's log → `logs/selected/`
   - Other agents' logs → `logs/alternatives/`
6. Removes the winning agent's worktree
7. Deletes the winning agent's local branch
8. Commits the changes
9. Shows cleanup options for remaining worktrees/branches

### Arena Mode with Adoption

When `--adopt` is used, the CLI prints diffs from losing agents after merging the winner. The diffs show what each losing agent has that the winner doesn't.

**What to review and adopt:**
- Extra tests and edge case coverage
- Better error handling or validation
- Documentation improvements (comments, docstrings, README updates)
- Edge case handling the winner missed
- Performance optimizations

**What NOT to adopt:**
- Architectural changes that conflict with the winner's approach
- Duplicate implementations of the same logic
- Code that contradicts the winner's design decisions

**Steps after reviewing diffs:**
1. Review each diff section — look for valuable additions
2. Apply selected changes manually (copy relevant code from the diff)
3. Run tests to ensure adopted changes work with the winner's implementation
4. Commit the adopted improvements
5. Clean up remaining branches with `{{CMD_PREFIX}}feature-cleanup`

Adopted agent branches are kept for reference until you run cleanup.

### Cleanup after Arena

After merging the winner, you'll see cleanup options for the losing implementations:

```
{{CMD_PREFIX}}feature-cleanup {{ARG1_SYNTAX}}         # Delete locally
{{CMD_PREFIX}}feature-cleanup {{ARG1_SYNTAX}} --push  # Push to remote first
```

Use `--push` if you want to preserve the alternative implementations on the remote repository.

## Important Notes

- **Solo worktree**: The agent is auto-detected — no need to specify it
- **Arena mode**: The agent parameter is REQUIRED (e.g., `cc`, `gg`, `cx`, `cu`)
- **`--adopt`**: Only available in arena mode — requires a winning agent
- **Do NOT run from a worktree**: Always run from the main repository
- The command uses `--no-ff` merge to preserve feature history
- Alternative implementations are preserved in `logs/alternatives/` for future reference

## Suggest Next Action

After the command completes, check the pipeline and suggest the most useful next step:

1. If `--adopt` was used and diffs were printed, suggest the agent **review the diffs above and selectively apply valuable improvements** before cleanup. This is the highest priority next action.

2. If the feature used **arena mode** (without `--adopt`) and has remaining worktrees, suggest cleanup first:
   `{{CMD_PREFIX}}feature-cleanup <ID>`

3. Otherwise, check the pipeline:
   - List files in `./docs/specs/features/02-backlog/` matching `feature-*.md`
   - If features exist in **backlog**: suggest setting up the next one — `{{CMD_PREFIX}}feature-setup <next-ID>`
   - If backlog is empty, list files in `./docs/specs/features/01-inbox/` matching `feature-*.md`
   - If features exist in **inbox**: suggest prioritising — `{{CMD_PREFIX}}feature-prioritise`
   - If both are empty: let the user know the pipeline is clear

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID/name from the pipeline check above.
