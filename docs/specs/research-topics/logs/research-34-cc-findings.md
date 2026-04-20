# Research Findings: feature set

**Agent:** Claude (cc)
**Research ID:** 34
**Date:** 2026-04-20

---

## Key Findings

### The real question is about the conductor layer, not the abstraction

Re-reading the topic's primary motivation: the point of "feature sets" is to give
Aigon a **set-level autonomy boundary** — kick off a cohesive batch of 3–5
features, walk away, come back to them merged in dependency order. The
abstraction (tag vs manifest vs entity) is secondary — what it actually needs
to enable is a loop that can walk a list and invoke the existing
AutoConductor per feature without human intervention between them.

So the research naturally splits in two:

1. **Membership model** — how do we mark N features as "belonging together"?
2. **SetConductor** — what new process/state walks that list and delegates down
   to the existing single-feature `feature-autonomous-start __run-loop`?

You can answer (1) minimally (tag) and still have plenty of surface for (2).

### What already exists to build on

- `lib/entity.js` has `depends_on` frontmatter parsing, ID resolution, full
  dependency graph builder, DFS cycle detection, manifest mirroring. Topological
  ordering of a feature list is **already solved** — reuse it as-is.
- `lib/commands/feature.js` `feature-autonomous-start __run-loop` is the proven
  single-feature loop: spawn agents → poll `allReady` → review/eval → `feature-close`
  → kill own tmux session. It already supports solo and Fleet, `--stop-after`,
  `--review-agent`, `--eval-agent`. Durable state via `.aigon/state/feature-<id>-auto.json`
  through `persistFeatureAutoState()`.
- `lib/workflow-core/` is event-sourced and exclusive-locked. If sets get their
  own durable lifecycle, the engine is a well-worn path.
- `lib/remote-gate-github.js` already gates `feature-close` on PR state — the
  set conductor can rely on `feature-close` for its "safe to start the next one"
  signal without duplicating the merge logic.
- `assertProCapability('Autonomous orchestration', ...)` is already the Pro gate
  in `feature-autonomous-start`. A SetConductor is the natural next rung on that
  ladder — it fits the existing Pro boundary without expanding it.

### Design options, narrowest to widest

**Option A — Tag-only (OSS, lightweight).**
- `set: <slug>` in spec frontmatter. Membership derived by scanning.
- `aigon set list` / `aigon set show <name>` — pure read commands.
- No new durable state. Progress = derived from member features' lifecycle states.
- Board: collapsible group/swimlane by `set:` tag.
- Gets you 80% of the *visibility* value. Delivers 0% of the autonomy value.

**Option B — Tag + conductor state (OSS tag, Pro conductor). Recommended.**
- Everything in A, plus `aigon set-autonomous-start <name>` (Pro) behind the
  same `assertProCapability` gate that guards single-feature autonomy.
- New `.aigon/state/set-<name>-auto.json`: `{ setName, members, order, currentFeature, completed[], failed[], status, startedAt, mode }` — parallels the existing feature auto-state shape.
- New tmux session name convention: `<repo>-s<slug>-auto`.
- SetConductor loop walks the topological order from `lib/entity.js`, invokes
  `feature-autonomous-start` per feature, polls the feature's auto-state file,
  moves on when `status === 'done'`.

**Option C — Feature-set as first-class workflow entity.**
- `.aigon/workflows/sets/<slug>/events.jsonl` + `snapshot.json` + XState machine.
- Folder structure under `docs/specs/feature-sets/01-inbox/02-backlog/...`.
- Parallels feature + research.
- Gives you: set-level actions from the dashboard, set lifecycle history,
  set-level signals (pause/fail/resume events), set-level evaluation.
- Cost: three specs (inbox/backlog/in-progress/done), a new lifecycle test
  surface, reconciliation work, dashboard action-registry changes, new
  `feature-set-reset` primitive. The post-F171 "engine is authority, folder is
  projection" pattern (`lib/spec-reconciliation.js`) would need extending again.
- Not worth the complexity until set-level lifecycle actions are a proven need.

### Concrete SetConductor design (Option B)

```
aigon set-autonomous-start <set-name> [--mode=sequential|parallel] [--review-agent=<agent>] [--stop-after=close]
```

**Loop** (detached tmux `<repo>-s<slug>-auto`):

1. Resolve members: scan specs for `set: <slug>`, build dep graph via
   `entity.js`, topological sort. Error on cycle (entity.js already does this).
2. For each feature in order:
   - Already closed? Skip, add to `completed[]`.
   - In progress? Attach to existing `feature-<id>-auto.json` instead of
     spawning a new AutoConductor.
   - Otherwise: invoke `feature-autonomous-start <id> <agents> [--review-agent=...]`
     exactly as a user would. Inherit agents from spec frontmatter or from
     a `set: { default_agents: [cc] }` block.
   - Poll `feature-<id>-auto.json` every 30s. Transition on `status`:
     - `done` → mark completed, continue.
     - `failed` → mark failed, **pause set** (do not skip downstream —
       downstream may depend on failed feature's code).
     - still `running` → keep polling.
3. When all members `done`: write `status: done` to set-auto state, kill own
   tmux session. (Mirrors single-feature AutoConductor's self-termination.)

**"Safe to start B after A" contract — defaults to merged-to-main.**
The cleanest answer is to wait for `feature-close` success. That means A is
merged (locally or via the GitHub PR gate). B then branches off a fresh main,
picks up A's code, and nothing gets stale-rebased. This is also the only
semantics where the current `remote-gate-github.js` blocking-close flow works
without special-casing. Waiting for `submitted` or `review-complete` saves time
but opens a branch-base rebasing problem that dwarfs the savings.

**Mode default: sequential.** Parallel-where-the-dep-graph-allows is attractive
but introduces worktree contention (Fleet features already claim multiple
worktrees) and makes the "which feature am I watching" UX fuzzier. Keep it for
a v2 flag once the sequential flow has stabilised.

**Mixed solo/Fleet within a set: allow.** The per-feature
`feature-autonomous-start` call already makes this choice per feature, so the
SetConductor just passes through — it doesn't need to know or care.

**Failure surfacing.** When a member feature's auto-state goes to `failed`:
- Write `status: paused-on-failure` to the set-auto state with the failing feature ID.
- Send a desktop notification via the existing `lib/supervisor.js` path.
- Dashboard shows the set card in an attention state with "Feature #N failed —
  resume or reset".
- User fixes the feature and runs `aigon set-autonomous-resume <name>`, which
  re-enters the loop from the saved `currentFeature` pointer.

**Restart recovery.** The set-auto state file is the recovery anchor. On
restart, `set-autonomous-start` sees an existing running-state file, reads
`currentFeature` + `completed[]`, and resumes polling without respawning already-running AutoConductors. Same pattern as AutoConductor's own
resume-if-found behaviour (`findAutoSessionNameByFeatureId`).

**Stop/pause/reset primitives** (parallel to feature-*):
- `aigon set-autonomous-stop <name>` — kills the SetConductor tmux session only. In-flight per-feature AutoConductor keeps going (user's choice whether to stop it).
- `aigon set-autonomous-reset <name>` — stop + clear set-auto state + does NOT touch per-feature state (that's what `feature-reset` is for).

### Branch-base / dependency correctness

With the sequential-after-merge default, branch bases are trivially correct:
every member feature starts from a fresh `origin/main` that already contains
its dependencies. This sidesteps the entire class of "B branched off stale
main and now conflicts with A's merge" bugs.

The moment you add parallel mode, you inherit Turborepo's hard problem: sibling
tasks need to share a computed result. For code, that means either (a) rebasing
dependent features onto their upstream's branch before merge (fragile —
upstream may still change in review) or (b) declaring parallel-safe sets as
*sets of independent features* with `depends_on = []` across all members. (b)
is what I'd ship first; (a) is speculative and probably never worth it.

### Dashboard surface

Derived-only; no new dashboard state:

- **Board**: optional group-by-set mode. Members render as today, grouped under a
  set header card with `N of M complete` progress bar and the current feature
  highlighted.
- **Set detail view**: accessible via clicking the set header. Shows dep graph,
  per-feature status, current/last event from the set-auto state, action buttons
  (start, stop, resume, reset).
- **Set-level card in the dashboard summary**: one line per active set, like the
  existing AutoConductor badge row.

Everything reads from the set-auto state file + per-feature snapshots +
`entity.js` dep graph — no new adapters or reconcilers needed. The central
action registry rule (`lib/feature-workflow-rules.js`) extends cleanly: add a
`set-*` registry module mirroring the shape.

### Telemetry and cost reporting

`lib/stats-aggregate.js` already rolls up per-feature stats to weekly/monthly.
Adding `per-set` rollups is a small derivation: group by `set:` tag at aggregation
time, cache to `.aigon/cache/stats-aggregate.json` with a bumped `CACHE_VERSION`.
No new stats.json file at the set level — stay with derived.

### Prior art summary (relevant takeaways only)

- **GitHub Actions `needs`** — the cleanest ergonomic analogy. `needs: [a, b]`
  declarative + a runner walks the DAG. UX pattern: collapsed summary row with
  expandable per-job drill-down. Directly applicable to the set detail view.
- **Turborepo task graph** — validates the "declarative deps + executor walks
  graph" model and the "parallel where safe, serial otherwise" default. Their
  `--parallel` flag was a later addition once sequential was trusted.
- **Linear Projects** — validates that "group has no own lifecycle, progress is
  derived from members" works in the real world. Projects have a target date
  and a % bar, and that's enough. Lowers the pressure to add a full entity.
- **GitHub Milestones** — absolute minimum viable: just a label + a % bar. Proof
  that the tag-only floor is coherent. Users use it a lot.
- **Devin / Factory** — decompose objectives themselves. Not a fit for Aigon's
  human-curated-features philosophy; explicitly out of scope.

### What to avoid

- **Don't parse `## Dependencies` prose** — same trap research-20 avoided. Keep
  set membership as machine-readable frontmatter only.
- **Don't cross-repo sets** — spec says out of scope; Pro/OSS split at
  docs/specs/features/MOVED-TO-AIGON-PRO.md makes cross-repo sets a deep rabbit hole.
- **Don't introduce a set-level eval stage.** A "review the whole set" step is
  tempting but (a) there's no prior art and (b) it would be built on top of
  individual feature reviews that already catch regressions. Let per-feature
  review + PR review do the job.
- **Don't auto-create sets from research eval.** Tempting ("research-eval
  produces 4 features → wrap them in a set automatically"), but sets should be
  a deliberate human choice. Offer it as an opt-in prompt, not a default.

### Trade-offs

| Concern | Mitigation |
|---------|-----------|
| Another always-on tmux loop to reason about | Mirrors existing AutoConductor — same mental model, same stop/reset discipline |
| "Mini-project" complexity creep | Ship Option B only. Do not add set lifecycle actions, set eval, set templates until a concrete user need appears. |
| Users may not need set-level autonomy | Gate it behind Pro (consistent with current Pro boundary). Tag + view is OSS; conductor is Pro. |
| Worktree contention in parallel mode | Ship sequential-only first. Parallel is a later flag once the simple flow is proven. |

## Sources

- `lib/commands/feature.js:2676-3436` — AutoConductor launcher + `__run-loop` body; reference for SetConductor design
- `lib/entity.js:138-725` — `depends_on` parser, canonicalisation, dep graph, cycle detection (reusable as-is)
- `lib/workflow-core/` — event-sourced engine path if Option C ever ships
- `lib/remote-gate-github.js` — PR-aware `feature-close` logic; underpins the "wait for merge before next" contract
- `lib/stats-aggregate.js` — derivation path for set-level telemetry
- `lib/supervisor.js` — existing notification channel for set-level failure surfacing
- `docs/specs/research-topics/05-done/research-20-feature-dependencies.md` — `depends_on` precedent; the tag-in-frontmatter pattern from here generalises directly
- GitHub Actions `needs` docs — https://docs.github.com/en/actions/using-jobs/using-jobs-in-a-workflow
- Turborepo task graph — https://turborepo.com/docs/crafting-your-repository/configuring-tasks
- Linear Projects — https://linear.app/docs/projects

## Recommendation

**Ship Option B — tag-only membership (OSS) + SetConductor (Pro) — in two stages.**

**Stage 1 (OSS, small):** `set:` frontmatter + scanner + `aigon set list/show/progress`
+ board grouping. No autonomy, but delivers the visibility value immediately and
lets the team confirm they actually want autonomous set execution before
building it.

**Stage 2 (Pro, medium):** `aigon set-autonomous-start|stop|resume|reset`, set-auto
state file, SetConductor loop, dashboard set card, failure-pause + notify.
Sequential-after-merge only; no parallel mode; no set-level eval.

**Defer Option C (set as first-class workflow entity).** Only reach for it if
`aigon set` starts needing its own lifecycle actions, its own event history, or
reconciliation with visible folders. Until then, the derived-from-members model
(Linear's approach) is less code and less ambient state.

**Explicitly do not build:**
- Automatic set creation from research-eval (offer as opt-in prompt only)
- Parallel execution (defer to v2 flag after sequential proves stable)
- Set-level evaluation (per-feature review + PR gate already cover this)
- Cross-repo sets (out of scope, matches Pro/OSS split)

The key design lock-in is the **"wait for merged-to-main before starting next"**
contract. That single decision collapses an otherwise nasty design space
(branch bases, rebasing, stacked PRs, worktree contention) into a straight line,
and keeps the SetConductor a thin orchestrator over the already-tested
single-feature loop.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feature-set-membership | Add `set: <slug>` frontmatter support, set scanner in `entity.js`, `aigon set list/show` CLI, board grouping by set. OSS. | high | none |
| feature-set-autonomous-conductor | SetConductor tmux loop + durable state file + `set-autonomous-start|stop|resume|reset` CLI. Sequential, waits for `feature-close` success between members. Pro (gated via `assertProCapability`). | high | feature-set-membership |
| feature-set-dashboard-view | Set detail card: progress bar, dep graph, current feature, action buttons. Extends dashboard action registry with `set-*` actions. Pro. | medium | feature-set-autonomous-conductor |
| feature-set-telemetry-rollup | Per-set rollup in `lib/stats-aggregate.js` (bump `CACHE_VERSION`); `aigon stats --set <slug>`; set column in weekly/monthly buckets. | low | feature-set-membership |
| feature-set-parallel-execution | Optional `--parallel` mode: execute independent members concurrently, serialise on `depends_on` edges. Worktree-contention aware. Pro. | low | feature-set-autonomous-conductor |
