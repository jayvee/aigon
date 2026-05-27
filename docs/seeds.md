# Seed Repos (Maintainer Guide)

> **Note for end users:** if you're trying out Aigon with a demo repo, `aigon install-seed brewboard` clones the demo to `~/src/brewboard` and strips `origin` — the result is an isolated local sandbox. `aigon seed-reset` wipes that sandbox and re-clones. No remote pushes happen. The two-repo workflow described below applies only to seed maintainers who publish demo content.

Seed repos are demo projects used for testing (smoke tests, manual demos, maintainer benchmarks). Each seed has **two GitHub repos** with different roles, owned by the seed maintainer.

## Two-repo architecture (maintainer-only)

| Repo | Role | URL |
|------|------|-----|
| `brewboard-seed.git` | **Source of truth** — cloned from on reset | `https://github.com/jayvee/brewboard-seed.git` |
| `brewboard.git` | Working copy — feature branches land here | `https://github.com/jayvee/brewboard.git` |

Maintainers opt into the two-repo workflow by setting `seedWorkingRepos` in `~/.aigon/config.json`:

```json
{
  "seedWorkingRepos": {
    "brewboard": "https://github.com/jayvee/brewboard.git",
    "trailhead": "https://github.com/jayvee/trailhead.git"
  }
}
```

When a working repo is configured for a seed, `aigon seed-reset <name>`:
- Closes open feature/research PRs on the working repo
- Deletes feature/research branches on the seed and working remotes
- Repoints `origin` to the working repo after clone
- Force-pushes the provisioned baseline to both remotes after provision

When `seedWorkingRepos` is absent or doesn't contain the seed (the default for end users), `seed-reset` is a local-only operation — no PR cleanup, no branch deletion, no force-pushes — and `origin` is removed entirely after clone.

## Critical rule: push to both repos

If you make a permanent change to a seed (new feature, updated implementation, refactored component), you **must** push to `brewboard-seed.git` or it will be wiped on the next reset:

```bash
cd ~/src/brewboard
git add <files> && git commit -m "..."
git push origin main                                         # brewboard.git
git push https://github.com/jayvee/brewboard-seed.git main  # brewboard-seed.git (source of truth)
```

Pushing only to `origin` (`brewboard.git`) is silently wiped when `seed-reset` runs next.

> ### ⚠️ Push from a clean main only
>
> `git push <seed-url> main` shoves whatever is on local `main` into the seed —
> including merged feature commits left behind by `aigon feature-close`. Pushing
> after running a feature poisons the seed: every subsequent reset re-clones
> the contaminated state and the demo no longer represents an unimplemented
> backlog. (Past incidents: F02 brewery-import, F09 dark-mode.)
>
> Before pushing, verify `git log --oneline origin/main..main` only shows
> commits you intend as permanent seed content — never `Merge feature N`,
> `feat: ...`, or anything an agent produced.
>
> `seed-reset` itself now refuses to force-push when the provisioned HEAD
> contains commits outside the allowlist (`chore: install Aigon v…`,
> `chore: update Aigon to v…`, `chore: strip stale seed config`) — see
> `validateSeedProvisionCommits` in `lib/commands/setup/seed-reset.js`. That
> guard catches contamination introduced through the reset cycle; this manual
> push path is on you.

## What lives in the seed

The seed repo contains the application source and aigon specs. Aigon runtime state is gitignored and rebuilt by `seed-reset`.

**Tracked (persisted in seed):**
- `src/` — application source code
- `docs/specs/` — feature and research specs
- `.aigon/docs/` — vendored docs and per-agent notes from `install-agent` (F421)
- `.aigon/install-manifest.json` — tracks aigon-owned files with sha256 (F422)
- `.claude/`, `.agents/` etc. — agent config (written by `aigon install-agent`)

**Gitignored (rebuilt at reset time):**
- `.aigon/workflows/` — workflow snapshots and events
- `.aigon/state/` — per-agent status files
- `.aigon/locks/`, `.aigon/worktrees/`

This means: if you want a pre-baked workflow state for a feature (e.g. `code_review_in_progress` for a review bench), you cannot store it in the seed git. The benchmark machinery must bootstrap that state at runtime after reset.

## Current seeds

### brewboard (`~/src/brewboard`)

A Next.js beer catalogue app. Used by maintainer benchmarks (feature 07: add-footer) and review bench fixtures (feature 08: rating-filter, pre-baked with 5 planted weaknesses).

Feature 08 (rating-filter) has a working implementation intentionally left with weaknesses for review bench scoring. Do not "fix" these weaknesses — they are the test signal:
1. `style={{ fontWeight }}` mixing inline styles with Tailwind
2. `style={{ color: '#78716c' }}` hardcoded hex instead of Tailwind class
3. `filtered` computed without `useMemo`
4. Filter buttons missing `aria-pressed`
5. Threshold array `[0, 3.5, 4.0, 4.5]` as magic literals in JSX

### trailhead (`~/src/trailhead`)

A React Native trail-tracking app. Used for iOS/mobile agent testing.

## seed-reset internals

For implementation details: `lib/commands/setup/seed-reset.js` and `lib/commands/setup.js` (`seed-reset` command handler). The reset sequence is: Nuke → Clone from seed → Provision (aigon apply, install-agent, npm install) → Force-push to both remotes.
