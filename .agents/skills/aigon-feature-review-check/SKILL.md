---
name: aigon-feature-review-check
description: Check the review just done on the current feature worktree and decide accept/revert/modify
---

# aigon-feature-review-check

A reviewing agent has just committed fixes (or notes) on this feature branch. Your job — as the **implementing agent** — is to read what the reviewer did, then decide how to respond: **accept**, **revert**, or **modify**.

## Step 0: Resolve the feature ID

If the user already passed an explicit feature ID as the command argument, use that ID and skip to Step 1.

Otherwise — the primary path — infer the ID from the current branch. You should be running this inside the implementation worktree:

```bash
BRANCH=$(git branch --show-current)
echo "Branch: $BRANCH"
```

Expected branch shape: `feature-<slug>-<agent>` (e.g. `feature-check-review-skill-command-cc`).

Parse the `<slug>` out of the branch name (strip the `feature-` prefix and the trailing `-<agent>` suffix where agent is one of `cc`, `gg`, `cx`, `cu`). Then resolve the slug to a feature ID by matching against `aigon feature-list --active`:

```bash
aigon feature-list --active
```

Find the row whose name matches the slug and read its ID.

**If the branch is `main`** or doesn't match the `feature-<slug>-<agent>` pattern: STOP. Print this one-liner and do nothing else:

> Can't infer feature ID — run this inside the feature worktree, or pass an explicit ID (e.g. `$aigon-feature-review-check 230`).

Do **not** guess. Do **not** prompt the user to pick from a list — that's noise. Just stop.

## Step 1: Find the review commits

Look at every commit on this branch that came from a reviewer:

```bash
git log --oneline --grep='^fix(review)\|^docs(review)' main..HEAD
```

For broader context (your own implementation commits too), also run:

```bash
git log --oneline main..HEAD
```

If there are zero `fix(review)` / `docs(review)` commits, the review was clean — tell the user "Review found no fixes." and stop.

## Step 2: Read the diff

For each review commit, inspect the change:

```bash
git show <sha>
```

Understand what the reviewer changed and why. Pay attention to commit messages.

## Step 3: Read the review notes

Open the implementation log and read the `## Code Review` section the reviewer appended:

```bash
ls docs/specs/features/logs/feature-<resolved-id>-*-log.md
```

(There may be multiple log files for the feature — read the one matching your agent or the most recent one with a `## Code Review` section.)

## Step 4: Decide

You are the author of this code. The reviewer's changes are suggestions. You have full authority to accept, modify, or revert any review commit.

Pick **one** of these three options. Be honest — your job is correctness, not deference.

- **Accept** — the review is correct. Do nothing. Tell the user "Review accepted." and a one-line summary of what changed.
- **Revert** — you disagree with one or more of the reviewer's fixes. Revert the commits you disagree with using `git revert <sha>` and commit with a `revert(review):` prefix explaining why. You own this code — if a review change is wrong, undo it.
  ```bash
  git revert <sha> --no-edit
  git commit --amend -m "revert(review): <what was wrong with the reviewer's change>"
  ```
- **Modify** — the review is mostly right but needs follow-up changes (e.g., the fix introduced a bug, missed a related case, or needs a small adjustment). This includes partially reverting a review commit and re-applying it differently. Make the minimal edits, then commit each change with a `fix(post-review):` prefix:
  ```bash
  git add <files>
  git commit -m "fix(post-review): <what you changed and why>"
  ```

## Step 5: Report

Tell the user:

1. Which option you chose (**Accept** / **Revert** / **Modify**).
2. A one-line summary per review commit you looked at.
3. For **Modify**: the list of follow-up commits you made.
4. For **Revert**: which commits you reverted and why.
5. Any open questions for the user.

**Do NOT run `$aigon-feature-close`.** The user decides when to close the feature.
