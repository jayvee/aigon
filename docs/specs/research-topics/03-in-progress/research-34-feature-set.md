# Research: feature-set

## Context

**Primary motivation:** enable Aigon to autonomously execute a whole feature set end-to-end — kick it off once, walk away, and come back to a completed cluster of related features merged in dependency order. Today's autonomy stops at the single-feature boundary (AutoConductor: spawn → wait for submit → review/eval → close). The next level up is a **set-level conductor** that can chain features without human intervention between them. Everything else in this research exists to serve that goal.

After completing research topics, Aigon often produces a cluster of related features — typically three to five — that share a common goal and have dependencies between them. Aigon already handles individual feature dependencies (research-20), but there's no concept of **grouping features into a cohesive set** that can be reasoned about as a unit.

In traditional project management this is called an "epic" — a container for related stories/features. But Aigon is deliberately lightweight and spec-driven; adding a full Epic entity with its own lifecycle, state machine, and folder structure could introduce unwanted complexity.

The core question is whether there's a **minimal abstraction** — perhaps just a tag, a name, or a thin metadata layer — that gives Aigon (and its autonomy mode) enough information to:
1. Know which features belong together
2. Execute them in dependency order as a batch, autonomously
3. Track overall progress of the set without managing a separate entity lifecycle

Everything above single-feature autonomy is new ground — the research must describe concretely what changes at that layer, not just assert "autopilot handles it."

## Questions to Answer

### Concept Design
- [ ] What's the simplest viable abstraction? A tag/label on specs? A manifest field? A dedicated `.aigon/feature-sets.json` file? A section in the research evaluation output?
- [ ] Does a feature set need its own description/goal, or is it sufficient to just group features by a shared name?
- [ ] Should feature sets have their own lifecycle (open → in-progress → done), or should completion be derived from the status of member features?
- [ ] How should feature sets relate to the existing dependency system? Are they a layer above dependencies, or do they replace the need for explicit inter-feature `depends_on`?

### Creation & Workflow
- [ ] When research evaluation (`research-eval`) produces multiple features, should it automatically create a feature set?
- [ ] Should `feature-create` accept a `--set <name>` flag, or should grouping happen after creation?
- [ ] How would a user manually create or modify a feature set?
- [ ] Should the board/dashboard show feature sets as collapsible groups or swimlanes?

### Autonomy & Autopilot — elevating above single-feature AutoConductor

Today's AutoConductor (`feature-autonomous-start __run-loop`) runs one feature at a time: spawn agent(s) → poll for allReady → review or eval → `feature-close` → kill its own tmux session. There is no layer above that. This research must define what the **set-level** layer looks like and how it delegates down to the existing single-feature loop.

- [ ] What is the minimal new process/loop needed — a "SetConductor" tmux session that spawns and supervises per-feature AutoConductors in order? Or a single loop that walks the set and invokes `feature-autonomous-start` itself?
- [ ] Could `feature-autopilot` accept a feature set ID and execute all member features in dependency order, or does this warrant a distinct `set-autopilot` command?
- [ ] How does the set-level conductor decide "feature A is done, safe to start B"? Options: wait for `feature-close` to succeed (merged to main), wait for review-complete only, wait for `submitted` state. Each has different blast radius if a later feature depends on earlier code.
- [ ] Should member features run sequentially (safe, simple — B only starts after A merges) or in parallel where dependency graph allows (faster, but worktrees compete)? What's the right default?
- [ ] How does the conductor handle solo vs Fleet mode per feature? Can a set mix modes, or must the whole set pick one?
- [ ] What happens when one feature in a set fails review — does the whole set pause, do independent features continue, or does it fall back to human review? Where is the failure surfaced (dashboard badge, notification, a set-level log)?
- [ ] How does the conductor survive restarts — is the set's progress recoverable from durable state (events.jsonl + set manifest), the way a single AutoConductor is? What's the equivalent of `review-state.json` at the set level?
- [ ] How are branch bases handled when features depend on each other? Does B branch off A's merged main, off A's feature branch, or is the conductor expected to rebase?
- [ ] What does the user see while a set is running — a set-level dashboard card, a collapsible group of feature cards, a single "autopilot running" indicator with a drill-down?
- [ ] What's the stop/pause/resume contract for a running set? `sessions-close <setId>`? Per-feature `sessions-close` plus a set-level flag?
- [ ] How does progress reporting work — per-feature as today, plus a set-level summary (N of M merged, current feature, last event)?
- [ ] What's the cost/telemetry story — does `aigon stats` roll up per-set totals, and where does the aggregate live (new `stats.json` at the set level, or derived on read)?

### External Patterns & Prior Art
- [ ] How do spec-driven AI development tools (Cursor rules, Cline task groups, Aider sessions) handle multi-feature work?
- [ ] How do lightweight project trackers (Linear cycles/projects, GitHub milestones, Basecamp hill charts) group related work without heavy epic overhead?
- [ ] How do autonomous coding agents (Devin, Factory, Copilot Workspace) handle multi-step feature plans?
- [ ] What patterns exist in CI/CD for executing dependent jobs as a group (GitHub Actions job matrices, Turborepo task graphs)?
- [ ] Is there a pattern from monorepo tools (Turborepo `--affected`, Nx project graphs) that could inform how feature sets track "what's done"?

### Complexity & Trade-offs
- [ ] What's the risk of feature sets becoming "mini-projects" that need their own management overhead?
- [ ] Could a simpler approach — like just a `set:` tag in spec frontmatter and a board filter — achieve 80% of the value?
- [ ] Is there a version of this that requires zero new commands and just enhances existing ones?
- [ ] Should this be an Aigon Pro feature rather than core, to keep the open-source tool simple?

## Scope

### In Scope
- Survey of how other tools group related features/tasks
- Design options ranging from minimal (tag-only) to structured (new entity)
- Integration with existing dependency system (research-20)
- **Set-level autonomous execution** — a concrete design for how AutoConductor extends (or is wrapped) to run a whole set end-to-end, including sequencing, failure handling, durable state, and restart recovery
- Dashboard/board visualisation of grouped features
- Recommendation on whether to implement, and at what complexity level

### Out of Scope
- Implementation of the chosen approach (that becomes a feature spec)
- Changes to the state machine or manifest format (those would be in the feature spec)
- Full epic/project management capabilities (Jira-style)
- Cross-repo feature sets (only single-project scope)

## Inspiration
- Aigon's existing feature dependency system (research-20)
- Linear's "Projects" — lightweight groupings with progress tracking
- GitHub Milestones — simple label + completion percentage
- Turborepo's task graph — dependency-aware parallel execution
- Research evaluation flow that already produces multiple features as output
