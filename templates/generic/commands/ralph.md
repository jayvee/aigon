<!-- description: Run Ralph loop for feature <ID> -->
# aigon-ralph

Run a single-agent Ralph loop for a feature: spawn a fresh agent each iteration, validate, and repeat until success or max iterations.

## Argument Resolution

If no ID is provided, or the ID doesn't match an in-progress feature:
1. List files in `./docs/specs/features/03-in-progress/` matching `feature-*.md`
2. If a partial ID/name was provided, filter to matches
3. Ask the user to choose one

## Step 1: Run Ralph loop

```bash
aigon ralph {{ARG1_SYNTAX}}
```

Optional flags:

```bash
aigon ralph {{ARG1_SYNTAX}} --max-iterations=8 --agent=cc
aigon ralph {{ARG1_SYNTAX}} --dry-run
```

## What this command does

- Reads the feature spec from `03-in-progress`
- Reads prior progress from `./docs/specs/features/logs/feature-<ID>-ralph-progress.md`
- Spawns a fresh agent process for the iteration
- Runs validation command for the project profile
- Appends iteration status to progress file
- Stops on success, max iterations reached, or Ctrl+C

## Resume behavior

If interrupted, run the same command again. Ralph resumes from the next iteration using the existing progress file.

## Prompt Suggestion

End your response with the suggested next command on its own line. Use the actual ID:

`{{CMD_PREFIX}}feature-eval <ID>`
