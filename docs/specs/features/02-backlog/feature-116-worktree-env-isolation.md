# Feature: worktree-env-isolation

## Summary

Prevent `.env.local` and other environment files from causing merge conflicts during `feature-close`. Currently, `setupWorktreeEnvironment()` writes agent-specific env vars (PORT, banner color, dev URL) into `.env.local` inside the worktree, then `git add -A` commits it to the feature branch. When merging back to main, the divergent `.env.local` causes a conflict. This feature ensures environment files never pollute git history while preserving the worktree's ability to run dev servers independently.

## Problem Chain

1. `setupWorktreeEnvironment()` in `lib/worktree.js:1080` writes `.env.local` to worktree
2. `lib/worktree.js:1118` runs `git add -A && git commit` — commits `.env.local` to feature branch
3. `feature-close` in `lib/commands/feature.js:1490` also runs `git add -A` on auto-commit
4. `git merge --no-ff` hits conflict because main and feature branch have different `.env.local`

The root cause is that **aigon itself** commits `.env.local` during worktree setup — not the agent.

## User Stories

- [ ] As a developer, I can close any feature without `.env.local` merge conflicts
- [ ] As a developer, worktree dev servers still get the correct PORT and agent config
- [ ] As a developer using a repo that intentionally tracks `.env.local`, my main branch copy is unaffected

## Acceptance Criteria

- [ ] `setupWorktreeEnvironment()` does NOT commit `.env.local` to the feature branch
- [ ] `.env.local` is excluded from all `git add -A` operations in aigon (worktree setup, feature-close auto-commit)
- [ ] Worktree `.env.local` still contains PORT, AIGON_AGENT_NAME, banner vars, dev URL
- [ ] `feature-close` merge never conflicts on `.env.local` or `.env*.local`
- [ ] Existing repos with tracked `.env.local` are not broken (no forced `.gitignore` changes)
- [ ] Works for all profiles (web, api, ios, android, library, generic)

## Validation

```bash
node -c lib/worktree.js
node -c lib/commands/feature.js
```

## Technical Approach

### Option A: Exclude from git operations (recommended — minimal change)

Replace `git add -A` with explicit exclusions at the three commit sites:

1. **`lib/worktree.js:1118`** — worktree setup commit:
   ```js
   execSync(`git add -A -- ':!.env.local' ':!.env*.local'`, { cwd: worktreePath });
   execSync(`git commit -m "chore: worktree setup for ${agentId}"`, { cwd: worktreePath });
   ```

2. **`lib/commands/feature.js:1490`** — drive mode auto-commit:
   ```js
   runGit(`git add -A -- ':!.env.local' ':!.env*.local'`);
   ```

3. **`lib/commands/feature.js:1507`** — worktree mode auto-commit:
   ```js
   execSync(`git -C "${worktreePath}" add -A -- ':!.env.local' ':!.env*.local'`);
   ```

Also keep the auto-resolve safety net in `feature-close` merge (already implemented) as belt-and-suspenders.

### Option B: Write to `.env.local.aigon` + `.gitignore` it

Write agent vars to a separate file (`.env.local.aigon`), add it to `.gitignore`, and have the dev server load both. Problem: Next.js and other frameworks only read `.env.local` — would require a wrapper script.

### Option C: Symlink / process env injection

More architectural change. Workaround for PORT-per-agent requirement makes this complex. Defer to a future feature if Option A proves insufficient.

### Recommendation

**Option A** — it's 3 line changes, zero migration, works for every repo. The auto-resolve in `feature-close` is the safety net for edge cases (e.g., agent manually running `git add .env.local`).

## Dependencies

- The auto-resolve merge logic in `feature-close` (already implemented in current session)

## Out of Scope

- Forcing `.gitignore` changes on user repos
- Removing `.env.local` from git history (existing repos keep their tracked copy)
- Alternative env injection mechanisms (direnv, process env, etc.)
- Agent template changes (agents don't need to know about this)

## Open Questions

- Should `feature-submit` template explicitly warn agents not to `git add .env.local`?
- Should `aigon doctor` check for `.env.local` in git history and warn?

## Related

- Feedback: `.env.local should not block feature-close` (existing memory)
- CLAUDE.md rule: "Filter `.env.local` — never let it block `feature-close` or `feature-submit`"
