---
complexity: high
---

# Feature: perf-bench-fast-seed-and-resume

## Summary

Every benchmark pair currently spends 2-3 minutes on overhead before any AI work begins: a full `git clone` from GitHub (~45s), `npm install --prefer-offline` (~30s), two redundant `git push` calls back to remotes (~30s combined), and GitHub API calls to clean branches. The agent work itself is only 5-10 minutes — meaning 25-40% of wall time is pure infrastructure churn. This feature adds two improvements: (1) a **gold-image snapshot** (`aigon bench-snapshot brewboard`) that tarballs the fully-provisioned seed repo (including `node_modules` and `.git`) so resets extract a local file instead of hitting the network, cutting per-pair overhead from ~2-3 min to ~15-20s; and (2) a **resume flag** (`perf-bench --all --resume`) that writes a sweep-state file tracking which pairs have completed, so an interrupted run can pick up where it left off rather than starting from pair 1.

## User Stories

- As John running an 11-pair sweep, I want each pair reset to take 15-20 seconds instead of 2-3 minutes — so a full sweep takes ~2h instead of ~4h and the AI work is the actual bottleneck.
- As John with an interrupted sweep (crash at pair 6), I want to run `aigon perf-bench brewboard --all --agents gg,op --judge --resume` and have it skip the 5 pairs that already completed and continue from pair 6 — so no pair is repeated unnecessarily.
- As John setting up a fresh gold image after an aigon version bump, I want to run `aigon bench-snapshot brewboard` and have it perform one full seed-reset, then snapshot the result — so all subsequent benchmark runs in this session use the fast path.
- As John checking whether a gold image exists and is fresh, I want `aigon bench-snapshot brewboard --status` to print the image path, size, age, and the aigon version it was built with — so I know when to rebuild.

## Acceptance Criteria

- [ ] `aigon bench-snapshot <seed>` performs a full `aigon seed-reset <seed> --force`, then writes a compressed tarball to `~/.aigon/bench-seeds/<seed>-gold.tar.gz` containing the entire seed repo directory (including `.git` and `node_modules`). Prints size and path on completion.
- [ ] The tarball includes a `~/.aigon/bench-seeds/<seed>-gold.meta.json` sidecar with `{ aigonVersion, createdAt, seedUrl, workingRepoUrl }` so staleness and version drift can be detected.
- [ ] `aigon bench-snapshot brewboard --status` prints whether a gold image exists, its age, its aigon version, and its size. Exit 0 in both cases.
- [ ] When a gold image exists for a seed, `seed-reset` in benchmark context (detected via `AIGON_BENCH_MODE=1` env var set by `perf-bench`) uses the fast path: extract the tarball to the repo directory, `git remote set-url origin <workingRepoUrl>`, then rebuild .aigon state (manifests, collapse active stages) — skipping `git clone`, `npm install`, agent install, and both git pushes to remotes.
- [ ] Fast-path reset still deletes remote feature/research branches on the working repo before restoring the gold image, to avoid stale branches affecting the new pair's worktree setup.
- [ ] When a gold image's `aigonVersion` differs from the currently installed aigon version, `seed-reset` in bench mode prints a warning and falls back to the full reset path. The user can suppress this and force the snapshot with `--force-snapshot`.
- [ ] `aigon perf-bench brewboard --all --resume` reads `.aigon/benchmarks/sweep-<timestamp>.state.json` (the most recent state file for this seed), identifies completed pairs, and skips them. Prints `Resuming: N pairs done, M pairs remaining`.
- [ ] `perf-bench --all` (without `--resume`) writes a new sweep state file at the start and updates it after each pair completes (including failures). State file path: `.aigon/benchmarks/sweep-<iso-timestamp>.state.json`.
- [ ] Sweep state file schema: `{ seed, startedAt, completedAt, pairs: [{ agentId, modelValue, modelLabel, status: "pending"|"passed"|"failed", resultFile, completedAt }] }`.
- [ ] The `--resume` flag without an existing state file prints an error and exits 1.
- [ ] `npm run test:quick` passes. A unit test verifies resume logic: given a state file with 3 pairs done and 2 pending, assert that only the 2 pending pairs are included in the run.

## Validation

```bash
node --check lib/commands/setup/seed-reset.js
aigon bench-snapshot brewboard --status
aigon perf-bench brewboard --all --agents cc --dry-run
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May write to `~/.aigon/bench-seeds/` (new directory) to store gold image tarballs and metadata.
- May set `AIGON_BENCH_MODE=1` in the environment when `perf-bench` calls `seed-reset`, to signal the fast path without changing the `seed-reset` public API.

## Technical Approach

### Root cause: where the 2-3 min per-pair goes

| Step | Time | Eliminatable? |
|---|---|---|
| Delete remote branches (GitHub API) | ~20s | No — needed to keep worktree setup clean |
| `git clone` from seed GitHub | ~45s | **Yes** — replaced by tarball extract |
| `npm install --prefer-offline` | ~30s | **Yes** — node_modules baked into tarball |
| `aigon install-agent` (all agents) | ~8s | **Yes** — agents baked into tarball |
| Auto-commit | ~2s | **Yes** — git state baked into tarball |
| `git push --force` to working repo | ~15s | **Yes** — skip in bench mode (worktrees are local) |
| `git push --force` back to seed repo | ~15s | **Yes** — seed doesn't change between pairs |
| **Remaining overhead with snapshot** | **~25s** | — |

### 1. Gold image tarball

**`aigon bench-snapshot <seed>`** — new subcommand dispatched from `aigon-cli.js`, implemented in `lib/commands/bench.js`:

```
1. Run aigon seed-reset <seed> --force   (full clean, network, ~2-3 min once)
2. tar czf ~/.aigon/bench-seeds/<seed>-gold.tar.gz -C <parentDir> <repoName>
   (use spawnSync('tar', ['-czf', ...]) — macOS tar handles this fine)
3. Write ~/.aigon/bench-seeds/<seed>-gold.meta.json
4. Print: "✅ Snapshot saved: ~/.aigon/bench-seeds/brewboard-gold.tar.gz (142 MB, took 18s)"
```

**Fast restore in `seed-reset`** — in `clonePhase()` (lib/commands/setup.js ~line 3620):

```js
if (process.env.AIGON_BENCH_MODE && goldImageExists(seedName)) {
    const meta = readGoldMeta(seedName);
    const versionMatch = meta.aigonVersion === getAigonVersion();
    if (!versionMatch && !opts.forceSnapshot) {
        console.warn('⚠️  Gold image built with different aigon version — falling back to full reset');
        // fall through to normal clone
    } else {
        extractGoldImage(seedName, parentDir);          // tar xzf, ~10s
        execSync(`git remote set-url origin "${workingRepoUrl}"`, { cwd: repoPath });
        return true;  // skip provisionPhase entirely
    }
}
```

After fast restore, only run `rebuildSeedFeatureManifests` (manifests are gitignored, not in the tarball). Skip all git pushes.

### 2. Sweep state file

In `runAllBenchmarks` (lib/perf-bench.js ~line 640), before the loop:

```js
// Write initial state
const stateFile = path.join(benchDir, `sweep-${ts}.state.json`);
writeStateFile(stateFile, { seed, startedAt, pairs: allPairs.map(p => ({...p, status:'pending'})) });

// If --resume: load latest state, filter to pending pairs only
if (opts.resume) {
    const prev = loadLatestStateFile(benchDir, seed);
    if (!prev) throw new Error('No sweep state file to resume from.');
    const done = new Set(prev.pairs.filter(p=>p.status!=='pending').map(p=>benchKey(p)));
    pairs = pairs.filter(p => !done.has(benchKey(p)));
    process.stdout.write(`Resuming: ${done.size} done, ${pairs.length} remaining\n`);
}

// After each pair in the loop:
updatePairInStateFile(stateFile, agentId, modelValue, { status: ok?'passed':'failed', resultFile, completedAt });
```

### Key files touched

- `lib/commands/setup.js` — `clonePhase()` fast path; skip provision's two git pushes in bench mode
- `lib/commands/setup/seed-reset.js` — `goldImageExists`, `extractGoldImage`, `readGoldMeta` helpers
- `lib/perf-bench.js` — state file write/update/resume, pass `AIGON_BENCH_MODE=1` env to seed-reset
- `lib/commands/bench.js` (new or existing) — `bench-snapshot` command handler
- `aigon-cli.js` — dispatch for `bench-snapshot`
- `test/bench-resume.test.js` (new) — resume unit test

## Dependencies

- No hard dependencies. Independently useful from bench-monitor and bench-refresh (#503).

## Out of Scope

- Parallel pair execution (seed reset writes to a fixed path; parallelism needs separate seed paths — larger change).
- Automatic snapshot refresh on version bump (warn and fall back is sufficient).
- Snapshot compression tuning (default `tar czf` is fine).
- Snapshot sharing across machines.

## Open Questions

- Does `feature-close` or the benchmark harness ever push to GitHub during a pair run? If not, the working-repo push can be skipped entirely in bench mode. Check `feature-close` in `lib/commands/feature.js` — benchmark pairs use `feature-cleanup`, not `feature-close`, so likely safe to skip.

## Related

- Set: agent-benchmarks
