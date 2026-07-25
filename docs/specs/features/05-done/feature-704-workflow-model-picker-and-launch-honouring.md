> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.

# Feature: workflow-model-picker-and-launch-honouring

## Summary (reframed)

**Primary gap:** Workflow definitions already encode model and effort intent (stage triplets, `stages[].models`, and `resolveAutonomousInputs()` in OSS `aigon`). **`feature-autonomous-start --workflow=<slug>` does not pass that intent into `feature-start`**, so worktrees are created with default config unless the user duplicates overrides via `--models` / `--efforts` or environment variables. The CLI still prints that overrides are “resolved but not yet applied.”

**Scope split:** Ship **launcher honouring + precedence + tests** first (Phase 1). Treat **canonical model catalog, strict workflow validation, and remaining modal/save gaps** as Phase 2 or a separate feature so this spec has one falsifiable finish line.

## Cross-repo touch

All implementation lands in `~/src/aigon`; `aigon-pro` owns only this spec.

**Phase 1 — required files (indicative):**

- `lib/feature-autonomous.js` — merge `workflowDefaults` model/effort maps into `feature-start` argv; remove obsolete warning once behaviour matches.
- `lib/feature-start.js` — unchanged contract if argv already carries merged `--models` / `--efforts` (verify parsing and edge cases).
- `lib/workflow-definitions.js` — reuse `resolveAutonomousInputs`; document which fields feed the launcher (avoid double-applying `models` vs `modelOverrides`).
- `tests/integration/` — new tests for workflow-at-launch and precedence (see Acceptance Criteria).

**Phase 2 — when tightening UX and safety (optional follow-on or same epic later):**

- `lib/agent-registry.js`, `templates/agents/*.json`, `workflow-definitions` validation, `templates/dashboard/js/actions.js`, docs under `site/content/reference/`.

## Problem statement

1. **Resolution exists:** `resolveAutonomousInputs(def)` produces `modelOverrides`, `effortOverrides`, and structured `models` from workflow JSON.
2. **Launch ignores it:** The autonomous outer path resolves the workflow then calls `feature-start` with **only** user-supplied `--models` / `--efforts`, not merged workflow defaults.
3. **User-visible lie:** A log line states workflow model overrides are not applied and points users at env vars — correct today, unacceptable once workflows advertise models.

## Scenario (repro)

1. Pick a workflow whose **implement** stage encodes model/effort (e.g. built-in `budget-sonnet-solo` or `premium-opus-reviewed-cx-high`, or any project workflow using triplets / `stage.models`).
2. Run `aigon feature-autonomous-start <id> --workflow=<slug>` **without** `--models=` / `--efforts=` (or use the dashboard with a workflow selected and no manual triplet edits).
3. **Expected:** Worktrees match the workflow’s model/effort intent (respecting `supportsModelFlag`).
4. **Actual today:** Defaults from config/env apply; workflow intent is dropped unless duplicated into flags.

## Phase 1 — In scope

- Merge workflow-derived model/effort overrides into the same argv surface `feature-start` already accepts (`--models=…`, `--efforts=…`).
- **Precedence** (document + test): explicit CLI/dashboard `--models` / `--efforts` **overrides** same-agent keys from the workflow; workflow overrides sit above persistent defaults already implemented in `feature-start` / config resolution (env / project / global / template) — spell the full chain in one subsection and add one integration test that proves **CLI beats workflow** for the same agent.
- Remove the “resolved but not yet applied” message once workflow intent is applied (or replace with a single factual line, e.g. what was merged).
- Agents with `supportsModelFlag: false`: **omit** CLI model flags for those agents; optional one-line stderr if a workflow requests a model flag they cannot honour.
- Dashboard path already builds CLI argv via `feature-autonomous-payload.js`; ensure **workflow + body models** combine with the same precedence (no duplicate or dropped keys).

## Phase 2 — Out of scope for Phase 1 (track separately)

- Machine-readable **model catalog** in `agent-registry` and catalog-driven **workflow validation**.
- **Save as workflow** round-tripping implement-stage choices into `stages[].models` / triplets if not already identical on reload.
- Dedicated **fleet eval-model** dropdown row (vs today’s eval agent select only).
- Research autonomous model UI.
- Provider browsing, pricing, ranking.

## User stories (Phase 1)

- [ ] As a user, when I start an autonomous run with `--workflow=<slug>`, the created worktrees use that workflow’s model/effort intent without copying values into `--models` by hand.
- [ ] As a user, when I pass both a workflow and explicit `--models=` for the same agent, the explicit flag wins.
- [ ] As a maintainer, I can rely on integration tests that lock the precedence behaviour so regressions are caught in CI.

## Acceptance criteria — Phase 1

- [ ] `feature-autonomous-start --workflow=<slug>` passes merged model/effort intent into `feature-start` for agents that support model flags (using the same `--models` / `--efforts` encoding `feature-start` already documents).
- [ ] The message in `lib/feature-autonomous.js` that workflow model overrides are “resolved but not yet applied” is **removed** once the above is true (no misleading guidance to use only env vars for workflow intent).
- [ ] Integration test: workflow with non-default implement triplet models → launched `feature-start` (or observable worktree config) reflects those models.
- [ ] Integration test: workflow model for agent X + `--models=X=other` → **other** wins for X.
- [ ] Regression: existing `npm test` / `node --check aigon-cli.js` in OSS `aigon` still pass; no change to persisted config files from a single autonomous launch.

## Acceptance criteria — Phase 2 (deferred; do not block closing Phase 1)

- [ ] Canonical model catalog + `agent-registry` read API.
- [ ] Workflow validate rejects unknown model ids and unsupported agents.
- [ ] Modal/save/eval UI items from the original broad spec, as prioritized separately.

## Precedence (normative for Phase 1)

Order from highest to lowest authority for **per-run** model id on a given agent at **feature-start** time:

1. Explicit `--models=` / `--efforts=` from CLI or dashboard body (after `feature-autonomous-payload` merge).
2. Workflow-derived overrides from `resolveAutonomousInputs` for that launch.
3. Existing stack inside `feature-start` / `getAgentCliConfig()` (env `AIGON_<AGENT>_<TASK>_MODEL`, project, global, template default) — **do not reimplement**; only ensure workflow values are injected **before** that resolution if that is how `feature-start` composes today, or document the actual call order once implemented.

## Validation

```bash
cd ~/src/aigon
node --check aigon-cli.js
npm test
```

(UI tests in Phase 2 if catalog/modal work returns.)

## Dependencies

- Cross-repo implementation in `~/src/aigon` (launcher, tests).
- Feature 233 (`cross-repo-feature-support`) or an agreed **manual paired-branch** workflow for editing OSS from a pro-owned spec — unchanged from prior spec.
- [feature-703-workflow-definitions-unified](/Users/jviner/src/aigon-pro/docs/specs/features/05-done/feature-703-workflow-definitions-unified.md) — workflow JSON and `resolveAutonomousInputs` are prerequisites.

## Related code pointers (OSS)

- Launcher warning and workflow branch: `~/src/aigon/lib/feature-autonomous.js` (workflow resolution + `feature-start` argv).
- Resolution helper: `~/src/aigon/lib/workflow-definitions.js` (`resolveAutonomousInputs`, `validateWorkflow`).
- Start argv parsing: `~/src/aigon/lib/feature-start.js` (`--models`, `--efforts`).
- Dashboard → CLI argv: `~/src/aigon/lib/feature-autonomous-payload.js`, `~/src/aigon/lib/dashboard-routes/entities.js` (POST `/api/features/:id/run`).

## Open questions

- Exact merge rules when both `stage.models` and implement triplets set the same agent (pick one source of truth in code comments + spec).
- Whether Phase 2 is a new feature id or a second milestone on 235 after Phase 1 ships.

## Related

- [feature-703-workflow-definitions-unified](/Users/jviner/src/aigon-pro/docs/specs/features/05-done/feature-703-workflow-definitions-unified.md)
