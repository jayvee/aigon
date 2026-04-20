# Research Findings: feature set

**Agent:** Cursor (cu)
**Research ID:** 34
**Date:** 2026-04-20

---

## Key Findings

### Concept design

- **Simplest viable abstraction (MVP):** Treat a “feature set” as a **stable identifier** shared by member specs (e.g. frontmatter `feature_set: <slug>`) plus an **optional** small manifest under `.aigon/` (e.g. `feature-sets/<slug>.json`) that stores only what autonomy needs: ordered member IDs, created-from-research link, and conductor cursor. Tags alone are enough for **board grouping and filters**; the manifest (or workflow-core-style events later) is what makes **set-level autopilot restartable** without inventing a full epic lifecycle.
- **Description / goal:** Not required for grouping. A one-line `feature_set_goal:` (or manifest `goal`) is useful for dashboard copy and for agents, but the set can be inferred entirely from shared metadata if you want maximum minimalism.
- **Lifecycle:** **Derive** from members (open/in-progress/done percentages like a GitHub Milestone). Avoid a parallel XState for “the set” unless you later need transitions that are not composable from feature states (e.g. “set paused” as a first-class halt across members).
- **Relationship to `depends_on` (research-20):** **Layer above, not a replacement.** The set answers “which features we batch together and visualize as one initiative”; `depends_on` remains the **source of truth for execution order and merge safety**. A set could even contain features with no cross-deps (parallelizable batch); deps still constrain ordering when present.

### Creation and workflow

- **`research-eval`:** When the evaluation emits multiple related features, it should **propose** a set slug and list members (already partly implied by coordinated `depends_on`). Auto-creating the shared frontmatter field (or manifest) reduces drift versus asking humans to tag later.
- **`feature-create`:** Prefer **`--feature-set <slug>`** (or `--set` if you standardize naming) at create time for low friction; also support **attaching after creation** (e.g. `aigon feature-set add/remove`) so ad-hoc work can join a set without respawning specs.
- **Manual edit:** Spec frontmatter + optional manifest; board filter by `feature_set`.
- **Dashboard / board:** **Collapsible group** keyed by set id is the highest leverage UI: reuses existing cards, adds hierarchy. Swimlanes are a second step if you want cross-set views.

### Autonomy and autopilot (set above AutoConductor)

- **Minimal new loop:** A **SetConductor** (dedicated tmux session, analogous to `<repo>-f<id>-auto`) that **does not reimplement** the per-feature loop. It should **invoke** `feature-autonomous-start` (or the same internal entry point the CLI uses) per member in **topological order** over the dependency graph restricted to set members. That preserves Solo/Fleet semantics inside each feature and limits new surface area.
- **Command shape:** **`aigon feature-set-autopilot <set-slug>`** (or `feature-autopilot --feature-set <slug>`) is clearer than overloading `feature-autopilot` without a discriminator. Implementation can share code paths.
- **“A done, start B”:** Default policy for **code-coupled** deps: wait until **`feature-close` has succeeded** (branch merged to main as today’s close semantics define). Waiting only for `submitted` or `review-complete` is faster but increases blast radius when B assumes A’s code on `main`. Make the wait policy **explicit per edge** or per set (conservative default: close/merge).
- **Parallelism:** Default **sequential** for the set conductor’s *scheduling* when any `depends_on` edges exist among pending work. Allow **parallel** only for members whose dependency closure is already satisfied (graph-aware), matching Turborepo/Nx “ready queue” mental model.
- **Solo vs Fleet:** MVP: **one mode for the whole set** (same args passed into each `feature-autonomous-start`). Mixing modes per member adds UX and failure-matrix complexity without clear demand.
- **Review failure:** **Pause the dependent subgraph**; features not in the failed node’s downstream closure could continue only if the product explicitly supports “best effort partial set” (likely not MVP). Surface at **set level**: conductor log + dashboard badge on set group + link to failing feature’s review state.
- **Restart survival:** Mirror AutoConductor: **durable file** for set conductor (current feature id, last event, timestamps). Optional append-only `events.jsonl` under `.aigon/feature-sets/<slug>/` if you want parity with workflow-core observability; start with a single JSON state file to stay small.
- **Branch bases:** After A closes to `main`, B’s implementation should follow **normal feature workflow from updated `main`** (same as human would). Rebasing B onto A’s feature branch is a power-user escape hatch, not the default conductor behavior.
- **User visibility:** **Set-level row** (progress N/M, current feature, last error) with **expand** to member feature cards. Reuse existing autopilot badges on the active feature.
- **Stop / pause / resume:** **Set conductor session** gets its own name pattern so `sessions-close` can be extended to accept set scope, or document `aigon sessions-close <featureId>` per active feature plus killing the set tmux. Pause = stop spawning next member + write `paused: true` in set state; resume = same conductor command idempotent resume.
- **Progress reporting:** Per-feature unchanged; set summary = **derived** (counts by workflow phase) plus conductor “current step” from durable state.
- **Cost / telemetry:** **Derive on read** from existing per-feature `stats.json` for MVP (`feature_set` tag as grouping key in aggregate). Persist set-level rollup only if dashboard perf requires it.

### External patterns and prior art

- **Spec-driven / IDE tools:** Cursor rules and task lists group work **by file and checklist**, not by merge-aware graphs; autonomy is session-scoped. That supports Aigon’s direction: **orchestration lives in Aigon**, not in editor metadata.
- **Lightweight trackers:** Linear **Projects** and GitHub **Milestones** are “label + progress from children” without epic ceremony — good analogy for **derived lifecycle**.
- **Autonomous agents:** Multi-step plans are usually **linear scripts or planners** with checkpoints; your SetConductor is the same pattern at repo scale.
- **CI/CD and monorepo graphs:** GitHub Actions DAGs and Turborepo/Nx **topological schedules with a ready queue** are the right precedent for **parallel-safe** set execution.

### Complexity and trade-offs

- **Risk of “mini-projects”:** Mitigate by (1) derived completion, (2) thin metadata, (3) no mandatory set entity for users who only want tags.
- **80% solution:** `feature_set` frontmatter + board filter + optional manifest for eval output may be enough **before** any autopilot.
- **Zero new commands:** Unlikely if you ship **set autopilot**; you can still ship **grouping-only** first with zero autopilot commands.
- **OSS vs Pro:** **Core:** grouping metadata + board + read-path aggregation. **Pro candidate:** set-level autopilot polish (notifications, cross-set analytics, fleet tuning) if you need a commercial differentiator — but the **conductor hook** should live in OSS behind a thin API so OSS users are not blocked.

---

## Sources

- Aigon architecture: AutoConductor behavior and review/eval loop — `CLAUDE.md` / `docs/architecture.md` (internal).
- Feature spec `depends_on` pattern — `templates/generic/commands/research-eval.md`, `docs/architecture.md` (`lib/entity.js` dependency parsing).
- Linear Projects — https://linear.app/docs/projects
- GitHub Milestones — https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones
- Turborepo task graphs / pipeline — https://turbo.build/repo/docs/core-concepts/monorepos/running-tasks

---

## Recommendation

Ship in **three layers**, smallest first:

1. **Grouping only:** `feature_set` (or `set`) in spec frontmatter + dashboard/board collapsible section + filters. No autopilot. Validates UX and spec ergonomics.
2. **Durable set manifest:** Optional `.aigon/feature-sets/<slug>.json` (member ids, ordering hint, provenance from research eval). Enables reliable tooling without a new workflow engine entity.
3. **SetConductor autopilot:** New command that runs a **dependency-respecting queue** of existing per-feature autonomous runs, defaulting to **merge-before-dependent-start**, with **durable set state** for resume and a single tmux session for supervision.

Keep **`depends_on` as canonical for order and safety**; the set is batching, visibility, and conductor scope — not a second dependency system.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feature-set-frontmatter-and-board-grouping | Add optional `feature_set` (or equivalent) on feature specs and render collapsible groups / filters on the board and dashboard. | high | none |
| research-eval-emit-feature-set-metadata | When research-eval proposes multiple features, write a proposed set slug and member list into evaluation output and optionally stamp frontmatter on created specs. | high | feature-set-frontmatter-and-board-grouping |
| feature-set-manifest-io | Optional `.aigon/feature-sets/<slug>.json` for member list, provenance, and tooling (validate membership, no second lifecycle machine). | medium | feature-set-frontmatter-and-board-grouping |
| set-conductor-autopilot-command | New CLI + tmux loop that sequences `feature-autonomous-start` per set member in topo order, waits for successful `feature-close` before starting dependents by default, and writes durable set conductor state for resume. | high | feature-set-manifest-io |
| set-conductor-failure-and-pause-semantics | Define and implement pause/stop/resume for set runs; surface set-level status when a member fails review or errors. | medium | set-conductor-autopilot-command |
| stats-aggregate-by-feature-set | Extend stats aggregation (or dashboard read path) to roll up costs/progress by `feature_set` without requiring a new on-disk stats file at first. | low | feature-set-frontmatter-and-board-grouping |
