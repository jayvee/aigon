# Research: feature-set

## Context

After completing research topics, Aigon often produces a cluster of related features — typically three to five — that share a common goal and have dependencies between them. Aigon already handles individual feature dependencies (research-20), but there's no concept of **grouping features into a cohesive set** that can be reasoned about as a unit.

In traditional project management this is called an "epic" — a container for related stories/features. But Aigon is deliberately lightweight and spec-driven; adding a full Epic entity with its own lifecycle, state machine, and folder structure could introduce unwanted complexity.

The core question is whether there's a **minimal abstraction** — perhaps just a tag, a name, or a thin metadata layer — that gives Aigon (and its autonomy mode) enough information to:
1. Know which features belong together
2. Execute them in dependency order as a batch
3. Track overall progress of the set without managing a separate entity lifecycle

This is especially relevant for **autonomy mode** (feature-autopilot), where Aigon could potentially take a feature set and work through it end-to-end: start feature A, submit, start feature B (which depends on A), submit, and so on — without human intervention between each step.

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

### Autonomy & Autopilot
- [ ] Could `feature-autopilot` accept a feature set ID and execute all member features in dependency order?
- [ ] What happens when one feature in a set fails review — does the whole set pause, or do independent features continue?
- [ ] Should there be a `set-autopilot` command, or should `feature-autopilot` be smart enough to detect it's part of a set?
- [ ] How would progress reporting work — per-feature as today, plus a set-level summary?

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
- Autonomy mode implications (batch execution of ordered features)
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
