# Feature: worktree-env-isolation

## Summary

Ensure `.env.local` is always gitignored in every aigon-managed repo, so worktree setup and feature-close never cause merge conflicts from environment files. The root cause was that `.env.local` was not in `.gitignore` — once gitignored, `git add -A` can't stage it. This feature ensures aigon enforces this as a default for all repos, not just ones we've manually fixed.

## What Already Happened

- Purged `.env.local` from aigon git history (31 commits rewritten)
- Added `.env.local` / `.env*.local` to aigon's `.gitignore`
- Added auto-resolve safety net in `feature-close` merge for `.env*.local` conflicts
- Verified all repos under `~/src/` have `.env.local` gitignored

## What Remains

Aigon must **proactively ensure** `.env*.local` is gitignored in every repo it manages, so this never recurs.

## Acceptance Criteria

- [ ] `aigon init` adds `.env.local` and `.env*.local` to the repo's `.gitignore` if not already present
- [ ] `aigon install-agent` checks and warns if `.env.local` is not gitignored
- [ ] `aigon doctor` detects tracked `.env.local` files and offers `--fix` to untrack + gitignore them
- [ ] `aigon seed-reset` ensures seed repos have `.env*.local` in `.gitignore`
- [ ] Worktree `.env.local` still gets correct PORT, banner vars, dev URL (no functional change)

## Validation

```bash
node -c lib/commands/setup.js
node -c lib/worktree.js
# After init on a fresh repo, .env.local should be in .gitignore
# After doctor --fix on a repo with tracked .env.local, it should be untracked
```

## Technical Approach

### 1. `aigon init` — add to `.gitignore` scaffold

When creating `.gitignore` (or appending to existing), include:
```
.env.local
.env*.local
```

### 2. `aigon install-agent` — warn on missing gitignore

During install, check `git ls-files .env.local`. If tracked, warn:
```
⚠️  .env.local is tracked by git — this will cause merge conflicts during feature-close.
    Fix: echo '.env.local' >> .gitignore && git rm --cached .env.local
```

### 3. `aigon doctor --fix` — auto-repair

Add a check that:
- Verifies `.env*.local` is in `.gitignore`
- If `--fix`: adds to `.gitignore` and runs `git rm --cached .env.local`

### 4. Keep the auto-resolve safety net

The `feature-close` merge auto-resolve for `.env*.local` and `.aigon/` conflicts stays as belt-and-suspenders for repos we don't control.

## Dependencies

- None (all infrastructure already exists)

## Out of Scope

- Changing how `setupWorktreeEnvironment()` writes `.env.local` (it's fine — the file just shouldn't be tracked)
- Filtering `git add -A` pathspecs (unnecessary if gitignored)
- Alternative env injection mechanisms (direnv, process env, symlinks)

## Related

- Feedback: `.env.local should not block feature-close`
- CLAUDE.md rule: "Filter `.env.local`"
