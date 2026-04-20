# Feature: dashboard-agent-model-picker

## Summary
When a user starts a feature — from the dashboard, from the CLI, or from a named workflow — they should be able to pick the full **{agent, model, effort}** triplet for each agent involved, and that choice must persist in the workflow engine state so it survives every respawn path (Autopilot iterations, manual restarts, AutoConductor review spawns, re-attach after a crashed session).

Three things are being unified here that today are scattered, ephemeral, or missing:
- **Model choice** — today only settable via env var (CLI-only, no dashboard, and silently reverts on respawn).
- **Reasoning effort** — today only settable via agent-global config (`model_reasoning_effort = "medium"` in `~/.codex/config.toml` for cx; equivalent flag for cc); no per-feature override anywhere.
- **Workflow stage templates** — `lib/workflow-definitions.js` stages today take only `agents: ['cc']`, a bare ID list. They can't express "this stage runs on cc-opus-xhigh effort", which means a named workflow can't capture the full runtime intent.

By the end of this feature, a workflow can say *"implement with cc on claude-opus-4-7[1m] at xhigh effort; review with cx on gpt-5.4 at high effort"*, the dashboard picker can override any of those three for a specific feature start, the chosen triplet lives in the engine snapshot, and every subsequent spawn of that agent on that feature uses exactly the same triplet until the feature closes.

## Desired Outcome
Picking a model and effort in the dashboard — or by choosing a named workflow — is **as durable and authoritative as picking the agent itself.** The snapshot says "feature 288 · cc · claude-sonnet-4-6[1m] · medium effort", every future spawn path reads that snapshot, and the running triplet is visible on the dashboard card. If I come back tomorrow after an Autopilot iteration overnight, the same triplet is still running, and `aigon stats` shows cost attributed to the right model + effort combination.

## User Stories
- [ ] As a token-conscious user, when I start feature #288 I pick "Sonnet 4.6" model and "medium" effort from dropdowns, click Start, and every cc spawn for this feature — including iterate retries and review passes — runs on that exact triplet until the feature closes.
- [ ] As a Fleet user, when I start a feature with cc + cx + gg I can pick a different {model, effort} for each agent from the same modal.
- [ ] As a user debugging a long-running feature, the dashboard card shows the chosen model and effort under the agent badge so I can see at a glance which tier is burning my tokens.
- [ ] As a repo maintainer, I can leave the dropdowns on "Use config default" and get the pre-existing `aigon config models` behaviour unchanged.
- [ ] As an Autopilot user, an iterate retry re-spawns cc with the same model and effort I originally picked — no silent revert to any config default, no surprise at the weekly rate limit.
- [ ] As someone who cares about reproducibility, the event log stores the fully-qualified model ID (`claude-sonnet-4-6[1m]`) and the exact effort string (`xhigh`), not short aliases, so a feature closed in April is provably different from one closed in October if the "sonnet" alias silently rolled forward.
- [ ] As a workflow author, I can define a named workflow whose stages carry the intended {agent, model, effort} triplet so that "budget-sonnet-solo" vs "premium-opus-reviewed" are first-class workflow options the user can pick in one click.

## Acceptance Criteria
- [ ] `templates/agents/<id>.json` gains two additive fields under `cli`:
  - `modelOptions: [{ value, label }]` — fully-qualified model IDs in `value`, human labels. A sentinel `{ value: null, label: "Use config default" }` preserves current behaviour.
  - `effortOptions: [{ value, label }]` — effort strings accepted by the agent's CLI. Sentinel `{ value: null, label: "Use config default" }` preserves current behaviour.
- [ ] `lib/agent-registry.js` exposes `getModelOptions(agentId)` and `getEffortOptions(agentId)` derived from the JSON. No hardcoded model or effort lists elsewhere in the codebase.
- [ ] A new (or extended) endpoint returns agent metadata including both `modelOptions` and `effortOptions`. Dashboard calls it when opening the picker, not every frame.
- [ ] The agent-picker modal in `templates/dashboard/` adds **two** dropdowns per agent row: model and effort. Default selection is "Use config default" on both. cu shows both dropdowns disabled ("n/a — no CLI flag") since Cursor's CLI exposes neither.
- [ ] Start endpoint (`POST /api/feature/start` or equivalent) accepts `{ agents: [{ id, model, effort }] }`. Missing or null model/effort means "use config default" — unchanged from today.
- [ ] `feature.started` event carries both `modelOverrides` and `effortOverrides` as sibling objects keyed by agent ID. `null`/missing on either = no override.
- [ ] The projector in `lib/workflow-core/projector.js` surfaces both on each agent in the snapshot: `snapshot.agents[id].modelOverride` and `snapshot.agents[id].effortOverride` (null when none).
- [ ] Every spawn path that launches an agent reads both overrides from the snapshot and injects them into the launch environment / CLI args. Inventory of call sites:
  - `lib/worktree.js#setupWorktreeEnvironment` / initial feature-start
  - `lib/commands/feature.js` AutoConductor `__run-loop` (iterate + solo-worktree review spawn)
  - Dashboard "Restart agent" action
  - `aigon feature-open` (re-attach / re-launch flow)
  - Autopilot `--iterate` retries
- [ ] `lib/workflow-definitions.js` stages accept a per-agent config form for the `agents` field: a stage can declare `agents: ['cc']` (legacy, uses defaults) **or** `agents: [{ id: 'cc', model: 'claude-opus-4-7[1m]', effort: 'xhigh' }]` (explicit triplet). Mixed in the same stage is allowed.
- [ ] Workflow validation in `lib/workflow-definitions.js` accepts and round-trips both forms; a workflow with an explicit-triplet stage is idempotent when loaded, serialised, and reloaded.
- [ ] At feature-start, if a workflow is selected and its stage declares a triplet, that triplet is written into `modelOverrides` / `effortOverrides` on `feature.started`. Dashboard-picker values take precedence over workflow-stage values.
- [ ] The dashboard card renders the chosen model and effort under the agent badge for `in-progress` and `in-evaluation` cards. Missing override shows the resolved default so the card never reads as "unknown".
- [ ] `aigon stats` cost attribution breaks down per-feature spend by the actual {model, effort} pair that ran, not by the config default.
- [ ] Regression tests cover: first-start respects chosen triplet; iterate-mode retry preserves both model and effort; manual dashboard restart preserves both; solo-worktree review spawn preserves both; Fleet mode with different triplets per agent round-trips through the snapshot; a named workflow with explicit triplets starts correctly and the triplet ends up in the snapshot; dashboard-picker overrides win over workflow-stage defaults.
- [ ] `docs/architecture.md` § State Architecture documents `modelOverrides` and `effortOverrides`; `docs/agents/cc.md` (and siblings) document the `modelOptions` / `effortOptions` shape and the "use long IDs for durability" rationale; `lib/workflow-definitions.js` comment block documents the new stage-agent form.

## Validation
```bash
node -c lib/agent-registry.js
node -c lib/workflow-core/engine.js
node -c lib/workflow-core/projector.js
node -c lib/worktree.js
node -c lib/commands/feature.js
node -c lib/dashboard-routes.js
node -c lib/workflow-definitions.js
npm test
bash scripts/check-test-budget.sh
```

## Technical Approach

### Why {model, effort} is the right pair (not just model)
Effort and model together are the real cost/capability knob. For the current token-reduction batch (F287–F290): F287 wants Opus + xhigh (judgment-heavy), F288 wants Sonnet + low (mechanical), F289 wants Sonnet + medium (mid complexity), F290 wants Sonnet + medium. Picking only the model leaves effort unresolved and you still silently get whichever effort the agent-global config sets — which defeats half the point.

### Why long IDs in stored values
Short aliases like `sonnet` and `opus` silently roll forward as new Claude versions ship. A feature closed on 2026-04-21 with `sonnet` means "whatever sonnet meant that day" — useless for reproducibility or cost audits. Long IDs (`claude-sonnet-4-6`, `claude-opus-4-7[1m]`, `gpt-5.3-codex`) address the exact model including context-window variant. Short aliases are allowed ONLY as the sentinel "Use config default" option, which stores null and defers to `aigon config models` at spawn time.

Same discipline applies to effort: stored values are the literal strings the agent CLI accepts (`low`, `medium`, `high`, `xhigh`), not abstractions. If cc introduces `xhigh+` tomorrow, the agent JSON gets a new entry; no mapping layer to translate.

### Shape of `cli.modelOptions` and `cli.effortOptions`
```json
{
  "id": "cc",
  "cli": {
    "models": { "implement": "sonnet", "research": "opus", "evaluate": "opus", "review": "opus" },
    "modelOptions": [
      { "value": null, "label": "Use config default" },
      { "value": "claude-haiku-4-5-20251001", "label": "Haiku 4.5 (fast/cheap)" },
      { "value": "claude-sonnet-4-6", "label": "Sonnet 4.6" },
      { "value": "claude-sonnet-4-6[1m]", "label": "Sonnet 4.6 (1M context)" },
      { "value": "claude-opus-4-7", "label": "Opus 4.7" },
      { "value": "claude-opus-4-7[1m]", "label": "Opus 4.7 (1M context)" }
    ],
    "effortOptions": [
      { "value": null, "label": "Use config default" },
      { "value": "low", "label": "Low" },
      { "value": "medium", "label": "Medium" },
      { "value": "high", "label": "High" },
      { "value": "xhigh", "label": "Extra-high" }
    ]
  }
}
```
Equivalent shapes for cx (`gpt-5.4` / `gpt-5.3-codex` / etc.; effort values `minimal` / `low` / `medium` / `high`) and gg (Gemini models; effort support needs verification during implementation). cu has neither `modelOptions` nor `effortOptions` — it's the "none" case.

### Workflow-stage extension
`BUILT_IN_WORKFLOWS` today:
```js
{
  slug: 'solo-cc-reviewed-cx',
  stages: [
    { type: 'implement', agents: ['cc'] },
    { type: 'review', agents: ['cx'] },
    ...
  ],
}
```
After:
```js
{
  slug: 'premium-opus-reviewed-cx-high',
  label: 'Premium: Opus xhigh → CX high',
  stages: [
    { type: 'implement', agents: [{ id: 'cc', model: 'claude-opus-4-7[1m]', effort: 'xhigh' }] },
    { type: 'review',    agents: [{ id: 'cx', model: 'gpt-5.4',             effort: 'high'  }] },
    { type: 'counter-review', agents: [{ id: 'cc', model: 'claude-sonnet-4-6', effort: 'medium' }] },
    { type: 'close' },
  ],
},
{
  slug: 'budget-sonnet-solo',
  label: 'Budget: Sonnet medium solo',
  stages: [
    { type: 'implement', agents: [{ id: 'cc', model: 'claude-sonnet-4-6', effort: 'medium' }] },
    { type: 'close' },
  ],
}
```
String-only `agents: ['cc']` keeps working for all existing workflows — bare strings mean "use config defaults", equivalent to `{ id: 'cc' }`.

The workflow layer becomes the natural place to encode a token/quality profile. "Budget sonnet solo" and "Premium opus reviewed" are one-click choices; they just set the same `modelOverrides` / `effortOverrides` fields the dashboard picker does.

### Precedence (highest wins)
1. **Event-log override** (dashboard picker or CLI flag) — what the user explicitly picked for *this* feature start
2. **Workflow-stage triplet** — if a named workflow was chosen and its stage declared a model/effort
3. **`aigon config models` resolution** — project > global > built-in default (unchanged from today)
4. **Agent JSON task default** (`cli.models.implement`)
5. **Agent CLI's own default** — whatever the agent picks when no `--model` flag is passed

The key invariant: (1) beats (2) beats (3). Effort follows the exact same chain with an analogous `aigon config effort` resolver (new; mirrors `getModelProvenance`).

### Engine state: additive, no migration
`feature.started` gets two optional sibling objects: `modelOverrides: { cc: "claude-sonnet-4-6", cx: null }` and `effortOverrides: { cc: "medium", cx: "high" }`. Existing events with neither field are treated as no-override. Closed features don't respawn, so no back-fill.

Projector adds `modelOverride` and `effortOverride` to each agent in the snapshot. Adapter includes both in dashboard responses.

### Spawn-path discipline
Centralise the launch composition in a single helper — `buildAgentLaunchInvocation(agentId, snapshot)` — that reads `snapshot.agents[id].{modelOverride, effortOverride}` and returns `{ env, args }` fragments. Every spawn site calls that helper. A regression test scans `lib/` for direct `spawn`/`execSync` calls against agent commands that bypass the helper and fails CI if new bypass routes appear.

This helper becomes the single source of truth for "how does an agent get its {model, effort} at launch" — supersedes the ad-hoc env-var plumbing that exists today.

### Frontend shape
Each agent row in the agent-picker modal gains two dropdowns:
```
[✓] cc  — Claude Code      Model: [Use config default ▼]  Effort: [Use config default ▼]
[✓] cx  — Codex            Model: [Use config default ▼]  Effort: [Use config default ▼]
[ ] gg  — Gemini           Model: [disabled]               Effort: [disabled]
[ ] cu  — Cursor           Model: [n/a — no CLI flag]      Effort: [n/a — no CLI flag]
```
When the user picks a workflow that already declares triplets, the dropdowns pre-populate with the workflow's values but remain editable. The user is always free to override — workflow defaults are suggestions, picker values are authoritative.

### Dashboard card display
Active cards render both the model and effort under the agent badge:
```
  [cc] claude-sonnet-4-6[1m] · medium    ← one line, monospace, concise
```
Or use the friendly labels from `modelOptions` / `effortOptions` if that fits better in the column.

## Dependencies
- None hard. Touches engine state + dashboard + agent registry + workflow definitions, but none are in flight in a way that would conflict.
- Related (not blocking): `feature-token-reduction-1-slim-always-on-context` (F287) touches prompt-template shape, not triplet plumbing. `feature-token-reduction-4-claude-prompt-cache-stable-prefix` (F290) touches prompt-cache composition, not model selection.

## Out of Scope
- Changing per-task model or effort defaults via the dashboard — that's `aigon config` / config file territory.
- cu model/effort selection — Cursor's CLI has no relevant flags; the dropdowns show "n/a" and the stored values are always null for cu.
- Automatic triplet recommendation ("this feature looks simple, use haiku + low") — speculative, separate feature.
- Per-iteration model/effort switching in Autopilot retries — if useful, that's its own feature.
- Migrating closed features' event logs to carry `modelOverrides` / `effortOverrides` — pointless, they never respawn.
- UI for editing model/effort mid-run — restart the agent instead. Simpler.
- Cost-prediction preview in the picker ("this run will cost ~X tokens based on spec length × {model, effort}").
- Adjusting Gemini effort/budget until `gemini` CLI support is verified during implementation — this feature ships with effort disabled for gg if the CLI doesn't expose it, and adds it later when it does.

## Open Questions
- Do we surface `{modelOverride, effortOverride}` in the `/api/stats` cost attribution now, or follow-up? (Lean: now. Otherwise per-feature cost breakdown is still wrong and the value prop weakens.)
- Should the picker offer task selection (research/implement/evaluate) in addition to model/effort, or keep task=implement for feature-start? (Lean: keep simple. Research gets its own picker via research-start.)
- How deeply do we verify Gemini's effort exposure? (Lean: implementation-time check. If `gemini --help` doesn't surface it, ship gg without effort and file a follow-up.)
- Should the precedence chain be configurable per-repo, or is "event > workflow > config" hard-coded? (Lean: hard-coded — configurability here is yak-shave territory and the chain matches user mental model.)
- What short `slug` should the built-in triplet workflows use? "budget-sonnet-solo" and "premium-opus-reviewed-cx-high" are descriptive but long. An alternative is agent-neutral names like "solo-cheap" / "solo-premium" / "fleet-premium-reviewed". (Lean: the descriptive versions — slugs are rarely typed; they're chosen in the UI.)

## Related
- Triggered by: 2026-04-21 conversation about F287–F290 token-reduction work and the user's need to run different features on different {model, effort} combinations for cost control.
- Existing `lib/config.js#getModelProvenance` resolves model from env > project > global > default. This feature adds a new, higher-precedence source ("event-log override") and introduces a parallel `getEffortProvenance` for the new axis.
- `aigon config models` already surfaces resolved per-agent/task models; an analogous `aigon config effort` command (or extension of the existing one) surfaces effort resolution for symmetry.
- CLAUDE.md § Write-Path Contract — reminder that any new read path (dashboard card rendering override, cost attribution using override) must be produced by every corresponding write path (every spawn site records, every respawn reads).
- `lib/workflow-definitions.js` § `VALID_STAGE_TYPES` — no new types; this feature only enriches the `agents` field's shape within existing stage types.
