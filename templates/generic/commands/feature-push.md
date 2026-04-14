<!-- description: Push feature branch to origin for PR creation -->
# aigon-feature-push

Push the current feature branch to `origin` with upstream tracking, making it available for pull request creation on GitHub.

This command does not alter workflow state, move specs, merge anything, or call `agent-status`. It is a simple `git push -u origin <branch>`.

## Argument resolution

- In a feature worktree, run this with no arguments and Aigon will infer the current feature branch.
- In the main repo or from a non-feature branch, pass `<ID>` and optionally `[agent]`.

## Run

```bash
aigon feature-push $ARGUMENTS
```

Examples:

```bash
aigon feature-push
aigon feature-push 55
aigon feature-push 55 gg
```
