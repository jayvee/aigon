# Feature 16: Ralph Wiggum Loop

## Summary

The Ralph Wiggum technique: a single-agent loop that repeatedly spawns a fresh AI agent to work through a task list until all items are done. Inspired by the [original Ralph pattern](https://ghuntley.com/ralph/) — cheerful persistence through simplicity. At its core: `while tasks remain; do aigon feature-implement; done`.

Each iteration gets a fresh context window. Progress persists via files (git history, progress log, task status). No orchestrator, no multi-agent coordination — just one agent, one task, loop until done.

## Inspiration

- [ghuntley.com/ralph](https://ghuntley.com/ralph/) — the original Ralph technique
- [minicodemonkey/chief](https://github.com/minicodemonkey/chief) — Go CLI that runs Claude in a loop, one commit per task
- [snarktank/ralph](https://github.com/snarktank/ralph) — autonomous agent loop with PRD-driven task tracking

## User Stories

- [ ] As a developer, I want an agent to automatically retry implementation when validation fails so I don't have to manually restart the process
- [ ] As a developer, I want a maximum iteration limit to prevent runaway loops
- [ ] As a developer, I want to see what happened in each iteration so I can understand what was tried
- [ ] As a developer, I want to interrupt and resume the loop without losing progress

## Acceptance Criteria

- [ ] New command `aigon ralph <feature-id>` (or `aigon feature-implement <id> --loop`) starts the loop
- [ ] Each iteration spawns a fresh agent session with clean context
- [ ] Agent runs validation after implementation (exit code from profile test/build commands)
- [ ] Loop stops on success (validation passes) or max iterations reached (default: 5)
- [ ] Progress file (`docs/specs/features/logs/feature-<id>-ralph-progress.md`) persists across iterations
- [ ] Each iteration commits its work before the next begins
- [ ] User can Ctrl+C to stop; re-running the command resumes from where it left off
- [ ] Works in solo mode (branch or worktree)

## Technical Approach

### Core Loop (in aigon-cli.js)

```bash
# The essence — everything else is polish around this
while [ $iteration -le $max_iterations ]; do
  # Spawn fresh agent with context
  $agent_cli "$prompt"

  # Run validation
  $validation_command
  if [ $? -eq 0 ]; then
    echo "Success on iteration $iteration"
    break
  fi

  iteration=$((iteration + 1))
done
```

### Implementation in JS

New CLI command `ralph` that:

1. Reads the feature spec to get acceptance criteria
2. Reads progress file (if resuming) to get context from prior iterations
3. Builds a prompt that includes: the spec, prior progress, and instruction to implement + commit
4. Spawns the agent CLI as a child process (fresh context each time)
5. After agent exits, runs validation (profile-aware: `npm test`, `xcodebuild test`, etc.)
6. Appends iteration results to the progress file
7. If validation fails and iterations remain, loops back to step 2

### Progress File Format

```markdown
# Ralph Progress: Feature 16

## Iteration 1 (2026-02-24 10:15:23)
**Status:** Failed
**Validation:** npm test exited with code 1
**Summary:** Implemented core loop but tests fail on edge case
**Files changed:** aigon-cli.js, templates/generic/commands/ralph.md

## Iteration 2 (2026-02-24 10:22:45)
**Status:** Success
**Validation:** All checks passed
**Summary:** Fixed edge case, all tests passing
**Files changed:** aigon-cli.js
```

### Agent Prompt Template

The prompt sent to each fresh agent session includes:
- The feature spec (acceptance criteria)
- The progress file (what was tried, what failed)
- Profile validation commands (what will be checked)
- Instruction: implement/fix, commit, then exit

### CLI Arguments

- `aigon ralph <feature-id>` — start or resume the loop
- `--max-iterations=N` — override default (5)
- `--agent=<id>` — which agent to use (default: cc)
- `--dry-run` — show what would run without executing

### Configuration in `.aigon/config.json`

```json
{
  "ralph": {
    "maxIterations": 5
  }
}
```

### Validation

Uses the existing profile system's test/build commands (WORKTREE_TEST_INSTRUCTIONS placeholder). No LLM-based criteria checking — that's a separate feature (Feature 17).

## Validation

```bash
node --check aigon-cli.js
node aigon-cli.js ralph --help 2>&1 | grep -q "ralph"
node aigon-cli.js ralph 16 --dry-run --max-iterations=1 --agent=cc
```

## Out of Scope (see related features)

- LLM-based acceptance criteria evaluation → Feature 17: Smart Validation
- Multi-agent orchestration / arena-mode loops → Feature 18: Conductor
- Custom validation scripts (`.aigon/validation.sh`) → Feature 17
- Task tracking integration during loop → Feature 18
- Cross-iteration learning

## Open Questions

1. **Iteration budget**: Is 5 a good default? Should it be higher for complex features?
2. **Resume behavior**: Re-run last iteration or start fresh from its output?
3. **Agent selection**: Default to `cc` or use whatever's configured?

## Dependencies

- Existing `feature-implement` command and workflow
- Profile system for validation commands (WORKTREE_TEST_INSTRUCTIONS)
- Git for progress persistence

## Related

- Feature 17: Smart Validation (enhances Ralph with LLM-based criteria checking)
- Feature 18: Conductor (orchestrates multiple Ralph loops across agents)
