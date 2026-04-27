<!-- description: Review feature <ID> - code review with fixes by a different agent -->
# aigon-feature-code-review

Perform a code review on another agent's implementation, making targeted fixes where needed. Use a different model than the implementer for best results.

You are doing a write-capable review pass, not a read-only review report.
Ignore any default "code review means findings-only" behavior for this task; this command is specifically a review-with-fixes workflow.

Your default action is:
1. identify a concrete issue
2. patch it in the feature worktree
3. commit it with `fix(review): ...`
4. leave only residual issues in notes

Do not stop at describing a fix if you can safely make it yourself.
A findings-only review is valid only when:
- the implementation is genuinely clean
- the remaining issue requires a broader architectural or product decision
- the issue is ambiguous and the correct behavior is not clear from the spec
- you are blocked by missing context or infrastructure you cannot safely change

## Argument Resolution
If no ID is provided or doesn't match an active feature, run `aigon feature-list --active`, filter to matches, and ask the user.

## Step 1: Gather all context (one tool call)

**Run this entire block in a single shell execution** — do not split it up. It fetches branch info, the full diff, and the implementation log in one shot so you can review immediately without extra round-trips.

**You MUST commit review changes to the FEATURE WORKTREE, never to main.**

```bash
BRANCH=$(git branch --show-current)
FEATURE_BRANCH=$(git branch --list 'feature-{{ARG1_SYNTAX}}-*' | head -1 | tr -d ' *')
WORKTREE=$(git worktree list | grep "feature-{{ARG1_SYNTAX}}" | awk '{print $1}')
echo "=== WORKSPACE ==="
echo "Current: $BRANCH  Feature: $FEATURE_BRANCH  Worktree: $WORKTREE"
echo "=== DIFF ==="
git diff "main..${FEATURE_BRANCH:-HEAD}"
echo "=== IMPLEMENTATION LOG ==="
cat docs/specs/features/logs/feature-{{ARG1_SYNTAX}}-*-log.md 2>/dev/null || echo "(no log found)"
aigon agent-status reviewing
```

The spec body was printed inline by the launching CLI — use that copy for acceptance criteria.

If you are on the feature branch, review files directly. If you are on main, use `git diff main..$FEATURE_BRANCH` / `git show $FEATURE_BRANCH:path` — do NOT `cd` into the worktree. Commit fixes with `git -C "$WORKTREE" add ... && git -C "$WORKTREE" commit -m "fix(review): ..."` (review commits on main cause conflicts at `feature-close`).

## Step 1.25: Research context (skip when none)

If the spec frontmatter has a `research:` field, read the linked findings before evaluating the implementation — they describe what the feature was supposed to deliver and why. If no `research:` field is present, skip this step.

```bash
SPEC_PATH=$(aigon feature-spec {{ARG1_SYNTAX}} 2>/dev/null || true)
RESEARCH_IDS=""
if [ -n "$SPEC_PATH" ] && [ -f "$SPEC_PATH" ]; then
  RESEARCH_IDS=$(awk '/^---[[:space:]]*$/{f=!f;next} f && /^research:/{
    sub(/^research:[[:space:]]*/,"")
    gsub(/[\[\]]/,"")
    gsub(/,/," ")
    print
  }' "$SPEC_PATH")
fi
if [ -n "$RESEARCH_IDS" ]; then
  for ID in $RESEARCH_IDS; do
    echo "=== Research $ID findings ==="
    for f in docs/specs/research-topics/logs/research-${ID}-*-findings.md; do
      [ -e "$f" ] || continue
      echo "--- $f ---"
      cat "$f"
    done
  done
else
  echo "(no research linked — skipping)"
fi
```

Use the findings to judge whether the implementation faithfully addresses the conclusions and constraints the research surfaced.

## Step 1.5: Scope baseline check

Before reviewing correctness, check for out-of-scope deletions. The scope snapshot at `.aigon/state/feature-{{ARG1_SYNTAX}}-file-snapshot.txt` (in the main repo) lists every tracked file at feature-start time.

```bash
# Check for deleted files and test file deletions in the diff
git diff --name-status "main..${FEATURE_BRANCH:-HEAD}" | grep '^D'
```

**Check for out-of-scope deletions first**, then proceed to correctness review. Flag any files deleted that:
- Are not related to the feature spec
- Are test files (`.test.js`, `.test.ts`, `*.spec.*`)
- Are from a different feature's implementation

Revert out-of-scope deletions before reviewing the rest of the diff.

## Step 2: Review

### You MUST fix now when the change is:
- Bugs / logic errors
- Missing edge cases from the spec's acceptance criteria
- Security issues (injection, XSS, CSRF)
- Obvious performance problems (N+1, unnecessary loops)
- Failing tests
- Missing error handling for likely failures
- Typos in user-facing strings
- Missing test wiring, command wiring, config updates, or registration needed for the shipped change to actually be protected or reachable
- Obvious omissions in a touched mechanism, such as producer/read-path mismatches or incomplete doctor/bootstrap coverage that are local to this branch and safe to patch

### You MAY leave notes only when:
- the fix would change the architecture or expand feature scope
- the correct behavior is ambiguous
- the issue spans a separate subsystem and is not safely patchable in this review pass
- you are blocked by missing infrastructure, permissions, or context

### You must NOT
- Refactor or restructure working code
- Change the architectural approach
- Add features beyond the spec
- Rewrite in your preferred style
- Add comments/docs to code you didn't change
- "Improve" code that already works
- Run lint, tsc, or build checks — focus on diff review only
- **Add a regression test by default.** When a bug is found, first ask: can the producer API be hardened (stricter types, enums, removed dead branch) to make re-introduction impossible? If yes, fix the producer. Add a test only when the bug is subtle enough that PR review genuinely won't catch it.

**Targeted fixes, not a rewrite.**

## Step 3: Make fixes and commit

For each issue you can safely patch: make the minimal fix in the worktree, commit with `fix(review): <description>` (use `git -C "$WORKTREE"` if you're on main).

Examples: `fix(review): handle null user in profile lookup`, `fix(review): escape HTML in user-provided content`, `fix(review): add missing await on async call`.

**If the implementation is solid, commit nothing for code.** A clean review is a valid outcome.
If you report an issue without fixing it, explain why it was not safe or appropriate to patch in this review pass. Do not hand the implementer a to-do list for issues you could have fixed yourself.

## Step 3.5: Run the iterate gate if you made code fixes

**If you committed no code fixes** (clean review or findings-only): skip this step entirely.

**If you committed code fixes:**

```bash
npm run test:iterate
```

That's it — scoped to your changes, <30s. Do NOT run `npm test` or `npm run test:ui` here; the pre-push gate catches the rest. Fix any failures before moving to Step 4. See `docs/testing.md` for the full rationale.

## Step 4: Update the implementation log and commit

Append:

```markdown
## Code Review

**Reviewed by**: <your agent ID>
**Date**: <date>

### Fixes Applied
- <commits made, or "None needed">

### Residual Issues
- <only issues not fixed, with reason left unresolved, or "None">

### Notes
- <observations for the user>
```

Commit with `docs(review): add review notes to implementation log` (via `git -C "$WORKTREE"` if on main). Do not skip this even when no code fixes were needed — the review log entry is the audit trail for the autonomous controller and dashboard.

## Step 5: Report, then signal completion

**First, report to the user:**

Say: "Code review done. [N] fix(es) committed." (or "Code review done. No fixes needed.") and show:
- Fixes committed (commit message + SHA for each)
- Residual unfixed issues with reason each was left unresolved, or "None"

**CRITICAL — do NOT run `aigon feature-close`, `aigon feature-eval`, or any other command. Your job ends with the signal below. The implementing agent handles everything after this.**

**Last action — run this and stop:**

```bash
aigon agent-status review-complete
```

**STOP. Do not suggest, offer, or run anything after `aigon agent-status review-complete`.**
