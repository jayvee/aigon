# Seed Repos

Seed repos are demo projects used for testing (perf-bench, smoke tests, manual demos). Each seed has **two GitHub repos** with different roles.

## Two-repo architecture

| Repo | Role | URL |
|------|------|-----|
| `brewboard-seed.git` | **Source of truth** — cloned from on reset | `https://github.com/jayvee/brewboard-seed.git` |
| `brewboard.git` | Working copy — feature branches land here | `https://github.com/jayvee/brewboard.git` |

`aigon seed-reset brewboard` always clones from `brewboard-seed.git`. After provisioning (agent install, npm, commits), it force-pushes to **both** repos to keep them in sync.

## Critical rule: push to both repos

If you make a permanent change to a seed (new feature, updated implementation, refactored component), you **must** push to `brewboard-seed.git` or it will be wiped on the next reset:

```bash
cd ~/src/brewboard
git add <files> && git commit -m "..."
git push origin main                                         # brewboard.git
git push https://github.com/jayvee/brewboard-seed.git main  # brewboard-seed.git (source of truth)
```

Pushing only to `origin` (`brewboard.git`) is silently wiped when `seed-reset` runs next.

## What lives in the seed

The seed repo contains the application source and aigon specs. Aigon runtime state is gitignored and rebuilt by `seed-reset`.

**Tracked (persisted in seed):**
- `src/` — application source code
- `docs/specs/` — feature and research specs
- `docs/agents/` — agent instructions
- `.claude/`, `.agents/` etc. — agent config (written by `aigon install-agent`)

**Gitignored (rebuilt at reset time):**
- `.aigon/workflows/` — workflow snapshots and events
- `.aigon/state/` — per-agent status files
- `.aigon/locks/`, `.aigon/worktrees/`

This means: if you want a pre-baked workflow state for a feature (e.g. `code_review_in_progress` for a review bench), you cannot store it in the seed git. The perf-bench machinery must bootstrap that state at runtime after reset.

## Current seeds

### brewboard (`~/src/brewboard`)

A Next.js beer catalogue app. Used by:
- `aigon perf-bench brewboard cc` — implementation bench (feature 07: add-footer)
- `aigon perf-bench brewboard-review` — review bench fixture (feature 08: rating-filter, pre-baked with 5 planted weaknesses)

Feature 08 (rating-filter) has a working implementation intentionally left with weaknesses for review bench scoring. Do not "fix" these weaknesses — they are the test signal:
1. `style={{ fontWeight }}` mixing inline styles with Tailwind
2. `style={{ color: '#78716c' }}` hardcoded hex instead of Tailwind class
3. `filtered` computed without `useMemo`
4. Filter buttons missing `aria-pressed`
5. Threshold array `[0, 3.5, 4.0, 4.5]` as magic literals in JSX

### trailhead (`~/src/trailhead`)

A React Native trail-tracking app. Used for iOS/mobile agent testing.

## seed-reset internals

For implementation details: `lib/commands/setup/seed-reset.js` and `lib/commands/setup.js` (`seed-reset` command handler). The reset sequence is: Nuke → Clone from seed → Provision (aigon init, install-agent, npm install) → Force-push to both remotes.
