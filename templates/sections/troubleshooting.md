**If the CLI fails with "Could not find feature in in-progress"** and you're in a worktree: the spec move was likely not committed before the worktree was created. Fix by running these commands from the worktree:
```bash
SPEC_PATH=$(aigon feature-spec {{ARG1_SYNTAX}})
git checkout main -- "$SPEC_PATH"
git commit -m "chore: sync spec to worktree branch"
```