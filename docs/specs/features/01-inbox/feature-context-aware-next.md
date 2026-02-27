# Feature: context-aware-next

## Summary
A single `/aigon:next` command (alias `/aigon:n`) that inspects the current git branch, worktree status, and kanban stage to automatically suggest or run the most likely next workflow action. Eliminates the need to remember command names entirely for the happy path.

## User Stories
- [ ] As a developer in a feature worktree, I want to type `/aigon:n` and have it detect I should submit, so I don't have to remember the command name
- [ ] As a developer on the main branch, I want `/aigon:next` to show me what's in progress and offer to continue the most recent item
- [ ] As a developer who just submitted, I want the next step (eval or done) suggested automatically based on solo vs arena mode

## Acceptance Criteria
- [ ] `/aigon:next` (and alias `/aigon:n`) is a registered command installed via `install-agent`
- [ ] Detects current context: branch name, worktree status, feature/research ID from branch pattern
- [ ] When on a feature branch in-progress: suggests `feature-submit` (or `feature-implement` if no changes yet)
- [ ] When on main with an in-progress feature: suggests `feature-eval <ID>` or `feature-done <ID>`
- [ ] When on main with nothing in-progress: shows board summary and suggests picking from backlog/inbox
- [ ] When in a research worktree: suggests `research-conduct` or `research-done`
- [ ] Displays the suggested command with a one-line explanation, ready to copy/run
- [ ] If multiple actions are plausible, shows a short numbered menu (max 3 options)
- [ ] Falls back gracefully when context is ambiguous — shows board instead of guessing wrong
- [ ] `node --check aigon-cli.js` passes

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach
- New command template `next.md` that instructs the agent to:
  1. Run `git branch --show-current` and `aigon board --list --active`
  2. Parse branch name for feature/research ID and agent code
  3. Run `aigon feature-implement --info <ID>` to get current stage
  4. Apply decision tree:
     - Feature branch + uncommitted changes → suggest `feature-submit`
     - Feature branch + no changes → suggest `feature-implement <ID>`
     - Main + feature in `03-in-progress/` + solo → suggest `feature-done <ID>`
     - Main + feature in `03-in-progress/` + arena → suggest `feature-eval <ID>`
     - Main + nothing active → show board, suggest `feature-now` or pick from backlog
     - Research branch → suggest `research-conduct <ID>` or `research-done <ID>`
  5. Present suggestion as ready-to-run slash command
- Add `'next'` and alias `'n'` to `COMMAND_ALIASES` and command lists
- The command is prompt-driven (agent reads context and decides) — no CLI logic needed

## Dependencies
- `aigon board --list --active` for state detection
- `aigon feature-implement --info` for feature stage
- Branch naming convention: `feature-<ID>-<agent>-<description>`

## Out of Scope
- Auto-executing the suggested command (always show and let user confirm)
- Handling multiple features in-progress simultaneously (pick the one matching current branch)
- Feedback workflow integration (can add later)

## Open Questions
- Should `/aigon:next` auto-execute the obvious action (e.g., submit when there are committed changes), or always confirm first? Recommend: always confirm first for safety.

## Related
- Research: research-03-simplify-command-parameters (menu clutter findings)
- Feature: command-aliases (short aliases, prerequisite)
- Feature: command-display-preference (controls short vs long in output)
