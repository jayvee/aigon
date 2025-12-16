# Feature: support-hooks

## Summary

Allow aigon users to define project-specific lifecycle hooks that run before and/or after standard aigon commands. This enables teams to integrate aigon with their specific infrastructure (databases, deployment platforms, etc.) without modifying the core aigon commands. Hooks are defined in a markdown file within the project and executed automatically when the corresponding aigon command runs.

## User Stories

- [ ] As a developer using aigon with Neon database, I want to automatically create database branches when setting up bakeoff worktrees, so each agent has an isolated database environment
- [ ] As a team lead, I want to run custom validation before feature implementation starts, so we catch configuration issues early
- [ ] As a DevOps engineer, I want to trigger deployment previews after bakeoff setup completes, so reviewers can test each implementation
- [ ] As a developer, I want to clean up resources (database branches, preview deployments) when a bakeoff is cleaned up

## Acceptance Criteria

- [ ] Aigon looks for a hooks file at a standard location - `docs/aigon-hooks.md` 
- [ ] Hooks file supports defining `pre-<command>` and `post-<command>` sections for any aigon command
- [ ] Pre-hooks run before the command executes; if a pre-hook fails, the command is aborted
- [ ] Post-hooks run after the command completes successfully
- [ ] Hooks receive context variables (feature ID, worktree paths, agent names, etc.) as environment variables
- [ ] Hook execution output is displayed to the user
- [ ] Missing hooks file is silently ignored (hooks are optional)
- [ ] Failed post-hooks warn but don't fail the overall command (command already completed)
- [ ] `aigon hooks list` shows all defined hooks for the current project
- [ ] Hooks can be shell commands or scripts

## Technical Approach

### Hooks File Location
Look for hooks in `docs/aigon-hooks.md`

### Hooks File Format
```markdown
# Aigon Hooks

## pre-bakeoff-setup

Creates database branches for each agent worktree.

```bash
for agent in $AIGON_AGENTS; do
  neon branches create --name "bakeoff-${AIGON_FEATURE_ID}-${agent}"
done
```

## post-bakeoff-setup

```bash
echo "Database branches created for feature $AIGON_FEATURE_ID"
```

## pre-bakeoff-cleanup

```bash
for agent in $AIGON_AGENTS; do
  neon branches delete "bakeoff-${AIGON_FEATURE_ID}-${agent}" --force
done
```
```

### Environment Variables Available to Hooks
| Variable | Description | Available In |
|----------|-------------|--------------|
| `AIGON_COMMAND` | The command being run | All hooks |
| `AIGON_FEATURE_ID` | Feature ID (e.g., "F042") | Feature commands |
| `AIGON_FEATURE_NAME` | Feature name slug | Feature commands |
| `AIGON_AGENTS` | Space-separated list of agents | bakeoff-setup, bakeoff-cleanup |
| `AIGON_WORKTREE_PATH` | Path to current worktree | bakeoff-implement |
| `AIGON_AGENT` | Current agent name | bakeoff-implement |
| `AIGON_PROJECT_ROOT` | Root directory of the project | All hooks |

### Implementation Steps
1. Add hook discovery logic to find and parse hooks file
2. Add hook execution function that runs shell commands with context
3. Modify command runner to check for and execute pre/post hooks
4. Add `aigon hooks list` command to show configured hooks
5. Add documentation for hooks feature

## Dependencies

- None (builds on existing aigon command infrastructure)

## Out of Scope

- Async/parallel hook execution (hooks run sequentially)
- Hook dependencies (one hook depending on another)
- Remote/shared hooks (hooks are always project-local)
- GUI for hook management
- Hook templates or marketplace

## Open Questions

- Should there be a `--skip-hooks` flag to bypass hooks for debugging?
- Should hooks support a timeout to prevent hanging?
- Should we support hook "profiles" (e.g., different hooks for CI vs local)?
- Should post-hooks receive the exit code of the main command?

## Related

- Research: None yet
- Claude Code has a similar hooks feature for tool execution that could inform design
