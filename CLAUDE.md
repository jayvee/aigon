# Aigon — CLAUDE Pointer

The full orientation lives in **`AGENTS.md`**. Read that first — it is the single source of truth for repo structure, the ctx pattern, the module map, state architecture, editing rules, testing discipline, and common mistakes.

## Hot rules (read before editing)
- **F313 frontmatter**: feature/research specs carry `complexity:` YAML only; model/effort defaults resolve at start from `templates/agents/<id>.json` `cli.complexityDefaults` then config (not from the spec). Parser: `lib/cli-parse.js parseFrontMatter`. Resolver: `lib/spec-recommendation.js`. Dashboard reads via `/api/recommendation/:type/:id` and pre-selects the start-modal dropdowns.


1. Run args verbatim — never add agents/flags from context.
2. Slash commands: `templates/generic/commands/` — never edit `.claude/commands/` copies. Cursor always-on rule: **`templates/generic/cursor-rule.mdc`** → install to **`.cursor/rules/aigon.mdc`** via **`aigon install-agent cu`**; do not edit the installed file as source (re-install overwrites).
3. After any `lib/*.js` edit, run `aigon server restart`.
4. After any `templates/dashboard/index.html` edit, take an MCP `browser_snapshot` (a11y tree) — fall back to `browser_take_screenshot` only when the change is purely visual (CSS, layout, color). See `CONTRIBUTING.md` § Browser MCP.
5. Never move spec files manually — use `aigon` CLI commands for state transitions.
6. **Pre-push gate** (before `git push`): `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`. **Iterate-loop gate** (per autopilot iteration) is `npm run test:iterate` — scoped, fast, NO Playwright, NO budget check. Don't run `npm run test:ui` mid-iteration unless the iteration touched dashboard files (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). The two gates are deliberately distinct — keep them so.
7. Use `Skill(frontend-design)` before any visual change.
8. To start a feature over: `aigon feature-reset <ID>` — never stitch raw cleanup commands.
9. Check `## Pre-authorised` before stopping on a policy gate — if the gate matches a listed line, proceed and add `Pre-authorised-by: <slug>` in the commit footer.

## Write-path contract (pointer)

Every write path must produce the state its read path assumes. Full rule, incident list, and grep discipline: **`AGENTS.md` § Write-Path Contract**.

**F294:** Removed `COMPAT_INBOX` / `LEGACY_MISSING_WORKFLOW` half-states. The dashboard still renders full grids: rows without a workflow snapshot return `WORKFLOW_SOURCE.MISSING_SNAPSHOT`; **inbox** and **backlog** folder positions still get synthetic pre-engine actions (Prioritise / Start) from `buildMissingSnapshotState`, while later-stage snapshotless rows stay inert. **CLI** entrypoints (`feature-list`, `feature-status`, `research-*`, close paths) **exit non-zero** where engine state is required and cite `aigon doctor --fix` — that is the loud path for operators.

**F296:** `feature-create` / `research-create` bootstrap slug-keyed inbox workflow state in the same write path as the spec; `doctor --fix` scans feature and research `01-inbox/` for snapshotless specs. Prioritise re-keys slug → numeric via `migrateEntityWorkflowIdSync` (F294/b1db12d3 incident: deleting compat read paths without fixing producers).

**F397:** Engine-first lifecycle precedence is now enforced via the shared `isEntityDone(repoPath, entityType, id, folderFallback)` helper in `lib/workflow-core/entity-lifecycle.js`. Snapshot is the source of truth; folder is consulted only when no engine dir exists (pre-start or pre-engine legacy). Sites updated: `set-conductor.isFeatureDone`, `feature-dependencies.checkUnmetDependencies`, `analytics.buildFeatureAnalytics` (UNION enumeration + `feature.closed` event timestamp), `dashboard-status-collector.collectDoneSpecs`, `workflow-read-model.buildMissingSnapshotState` (drift vs pre-start discriminator via `engineDirExists`), `entity.pause/resumePrestartEntity`, `entity.entityCloseFinalize` drift correction (now emits `spec.drift_corrected`), and the dependency-graph node colour helper.

## Reading order
1. `AGENTS.md` — orientation
2. `docs/architecture.md` — full module docs
3. `docs/development_workflow.md` — feature/research lifecycle
4. `aigon feature-spec <ID>` — active spec
5. `docs/agents/{id}.md` — agent-specific notes
