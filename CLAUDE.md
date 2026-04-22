# Aigon — CLAUDE Pointer

The full orientation lives in **`AGENTS.md`**. Read that first — it is the single source of truth for repo structure, the ctx pattern, the module map, state architecture, editing rules, testing discipline, and common mistakes.

## Hot rules (read before editing)
- **F313 frontmatter**: feature/research specs carry `complexity:` + `recommended_models:` YAML frontmatter. Parser: `lib/cli-parse.js parseFrontMatter` (inline `{}` maps supported). Resolver: `lib/spec-recommendation.js`. Dashboard reads via `/api/recommendation/:type/:id` and pre-selects the start-modal dropdowns. Missing frontmatter is valid; it falls back to `templates/agents/<id>.json cli.complexityDefaults`.


1. Run args verbatim — never add agents/flags from context.
2. Template source of truth is `templates/generic/commands/`. Never edit `.claude/commands/` working copies.
3. After any `lib/*.js` edit, run `aigon server restart`.
4. After any `templates/dashboard/index.html` edit, take a Playwright screenshot.
5. Never move spec files manually — use `aigon` CLI commands for state transitions.
6. `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` must pass before any `git push`.
7. Use `Skill(frontend-design)` before any visual change.
8. To start a feature over: `aigon feature-reset <ID>` — never stitch raw cleanup commands.
9. Check `## Pre-authorised` before stopping on a policy gate — if the gate matches a listed line, proceed and add `Pre-authorised-by: <slug>` in the commit footer.

## Write-path contract (pointer)

Every write path must produce the state its read path assumes. Full rule, incident list, and grep discipline: **`AGENTS.md` § Write-Path Contract**.

**F294:** Removed `COMPAT_INBOX` / `LEGACY_MISSING_WORKFLOW` half-states. The dashboard still renders full grids: rows without a workflow snapshot return `WORKFLOW_SOURCE.MISSING_SNAPSHOT` (no actions, no badge). **CLI** entrypoints (`feature-list`, `feature-status`, `research-*`, close paths) **exit non-zero** and cite `aigon doctor --fix` — that is the loud path for operators.

**F296:** `feature-create` / `research-create` bootstrap slug-keyed inbox workflow state in the same write path as the spec; `doctor --fix` scans feature and research `01-inbox/` for snapshotless specs. Prioritise re-keys slug → numeric via `migrateEntityWorkflowIdSync` (F294/b1db12d3 incident: deleting compat read paths without fixing producers).

## Reading order
1. `AGENTS.md` — orientation
2. `docs/architecture.md` — full module docs
3. `docs/development_workflow.md` — feature/research lifecycle
4. `aigon feature-spec <ID>` — active spec
5. `docs/agents/{id}.md` — agent-specific notes
