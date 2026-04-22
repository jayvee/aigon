---
complexity: medium
recommended_models:
  cc: { model: claude-sonnet-4-6, effort: medium }
  cx: { model: gpt-5.4, effort: medium }
  gg: { model: gemini-3.1-pro-preview, effort: medium }
  cu: { model: null, effort: null }
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-22T13:53:36.666Z", actor: "cli/feature-prioritise" }
---

# Feature: recommended-model-on-create

## Summary
Every Aigon feature spec is authored (or reviewed) by an AI agent that has just read the requirements and is about to hand the spec off to a second agent for implementation. The authoring AI knows more about the feature's complexity than any later process will — it *just analysed it*. Today that judgment is discarded: the downstream model-picker (F291) defaults to whatever `aigon config models` resolves, regardless of whether the feature is a 20-line config tweak or a 1000-line engine refactor.

This feature captures the authoring AI's complexity assessment as spec frontmatter, and uses it to pre-populate the start-feature modal with a per-agent {model, effort} recommendation. Two layers:

1. **Complexity rating** — a qualitative label (`low` / `medium` / `high` / `very-high`) the authoring AI assigns based on scope + risk + judgment-load.
2. **Per-agent recommendation** — for each configured agent (cc, cx, gg, cu), the recommended `{model, effort}` pair derived from the complexity level and the agent's `cli.complexityDefaults` map. The AI may override the derived value when it has specific context (e.g., "high-complexity BUT mostly mechanical — sonnet is fine").

When the operator clicks Start on a backlog card, F291's modal reads the frontmatter and:
- Shows a banner at the top: *"Recommended: complexity medium — cc on sonnet/medium, cx on gpt-5.4/medium"*
- Pre-selects the per-agent dropdowns to the recommendation (user can still override)

The goal is cheap-where-cheap, strong-where-needed, decided at the moment of maximum information — spec authoring — not at the moment of maximum hurry — feature launch.

## Desired Outcome
The operator never has to remember which model a given feature deserves. The authoring AI's complexity assessment flows from spec creation → start modal → actual launch, and the matching across agents is consistent rather than reliant on operator muscle memory. Cheap features run on cheap models by default; expensive features run on Opus by default; the operator overrides when they have context the AI lacked. Tokens saved on average, Opus-level judgment applied where it matters.

Bonus: spec-review commits can revise the complexity assessment. A second AI reviewing the spec may revise `complexity: low` → `high` if it spots a hidden engine interaction, and the revised value propagates to the start modal automatically.

## User Stories
- [ ] As an operator clicking Start on a backlog card, the modal shows the authoring AI's complexity assessment and per-agent {model, effort} recommendation at the top, pre-selected in the dropdowns. I click Start; it runs on the right tier without me thinking about it.
- [ ] As the authoring AI (cc, cx, gg, cu) writing a new spec via `aigon feature-create`, I fill in `complexity:` and `recommended_models:` frontmatter as part of the spec, based on the feature's scope + risk + judgment-load.
- [ ] As a spec-review AI, I can revise `complexity:` if I see the authoring AI misjudged (too-low or too-high). My review commit rewrites the frontmatter and the start modal reflects the new rating.
- [ ] As the operator, I can always override the recommendation in the modal. The AI recommends; the human decides.
- [ ] As a maintainer auditing past spend, I can correlate `complexity:` ratings to actual token cost (once `/api/stats` includes model/effort — F291 territory) and see where assessments over- or under-spent.
- [ ] As an agent author (adding a new agent to Aigon), I declare a single `cli.complexityDefaults` map in the agent JSON and get correct per-complexity recommendations for free.

## Acceptance Criteria
- [ ] Feature spec template gains optional YAML frontmatter block with two fields:
  - `complexity: low | medium | high | very-high` (single enum value)
  - `recommended_models:` map keyed by agent id, each entry `{ model: <string|null>, effort: <string|null> }`. `null` values fall back to the agent's `cli.complexityDefaults[complexity]` value.
- [ ] Missing / absent frontmatter is valid — treated as "no recommendation, use config defaults" (today's behaviour). No breakage for existing specs.
- [ ] `templates/agents/<id>.json` gains `cli.complexityDefaults` under the existing `cli` object:
  ```json
  "complexityDefaults": {
    "low":       { "model": "claude-haiku-4-5-20251001", "effort": "low" },
    "medium":    { "model": "claude-sonnet-4-6",          "effort": "medium" },
    "high":      { "model": "claude-sonnet-4-6[1m]",      "effort": "high" },
    "very-high": { "model": "claude-opus-4-7[1m]",        "effort": "xhigh" }
  }
  ```
  Populated for all four active agents (cc, cx, gg, cu — cu's values may be null per its CLI constraints).
- [ ] `lib/entity.js` (or a new helper) parses the frontmatter from a spec file via a tiny YAML reader (existing dependency if available, or ~30-line regex-based parser for the bounded schema). Returns a normalised object `{ complexity, recommendedModels }` or `null` when absent.
- [ ] The feature-create / research-create template (`templates/generic/commands/feature-create.md`, equivalent research) is updated to instruct the authoring agent to:
  - Assess complexity against a short rubric (in the template) — low = config tweaks, doc-only, single-file helpers; medium = standard feature with moderate cross-cutting; high = multi-file engine edits, new events, judgment-heavy; very-high = architectural shifts, write-path-contract territory.
  - Fill `complexity:` + per-agent entries in the frontmatter, using `cli.complexityDefaults` as defaults but free to refine per agent if the feature has specifics (e.g., "implementation is judgment-heavy for cc, mechanical for cx — use different effort levels").
- [ ] The spec-review template instructs the reviewing agent to verify the complexity rating and revise if wrong. The `spec-review:` commit includes the frontmatter edit.
- [ ] F291's start modal (`templates/dashboard/js/...`) reads the frontmatter via a new `/api/feature/:id/recommendation` endpoint (or extends an existing backlog-card endpoint) and:
  - Shows a small banner at the top: *"Recommended: complexity <level> — cc: <model>/<effort>, cx: <model>/<effort>, ..."*
  - Pre-selects each agent row's model and effort dropdowns to the recommendation (falls back to config default if the agent has no recommendation).
  - User can override; overrides still win (F291's existing precedence chain unchanged).
- [ ] Dashboard card on backlog shows a small complexity badge (color-coded: green/yellow/orange/red for low/medium/high/very-high). Makes the recommendation visible at a glance, not just in the modal.
- [ ] Regression tests:
  - Frontmatter round-trip: parser reads a spec with frontmatter, returns the expected normalised object.
  - No frontmatter fallback: parser returns null; modal pre-selects config defaults.
  - Null per-agent value falls back to `cli.complexityDefaults[complexity]`.
  - Authoring-agent template produces frontmatter (integration test that runs `aigon feature-create foo` and asserts the resulting file has a valid complexity frontmatter stub OR at least a frontmatter template ready to fill).
- [ ] `docs/architecture.md` § State Architecture adds a short subsection on spec frontmatter — what's allowed (`complexity`, `recommended_models`) and what's not (no workflow state, that's engine territory).
- [ ] CLAUDE.md / AGENTS.md Quick Facts references the frontmatter as the source of truth for complexity + model recommendations.

## Validation
```bash
node -c lib/entity.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/dashboard-routes.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if the frontmatter regression tests require it. Commit must cite this line in its footer.

## Technical Approach

### Why frontmatter (and not a separate metadata file)
Feedback entities already use YAML frontmatter for status — the precedent exists in the codebase. Frontmatter keeps the complexity + recommendations *with* the spec file, so they move together on spec-move transitions (inbox → backlog → in-progress) without a second artefact to keep in sync. It's also human-readable — the operator can glance at the spec and see the complexity rating without a tool.

The competing option (a sidecar `.aigon/feature-meta/<id>.json`) was considered and rejected: it doubles the write paths on every spec move, creates another read path the dashboard has to consume, and introduces a new state file that can drift from the spec. Frontmatter travels with the spec.

### Frontmatter schema (exact)
```yaml
---
complexity: medium            # low | medium | high | very-high
recommended_models:
  cc: { model: claude-sonnet-4-6,  effort: medium }
  cx: { model: gpt-5.4,            effort: medium }
  gg: { model: gemini-3.1-pro-preview, effort: medium }
  cu: { model: null,               effort: null }   # cu has no --model flag
---
```

Keys are intentionally minimal. No rationale field — if the authoring AI wants to explain an unusual recommendation, it writes it into the Summary or Technical Approach prose. Keeps the frontmatter machine-readable and bounded.

### How the authoring AI fills the frontmatter
The feature-create template gets a new "Before you write" preamble:

> Assess the feature's complexity against this rubric:
> - **low**: config tweaks, doc-only, single-file helpers, trivial bug fixes
> - **medium**: standard feature with moderate cross-cutting, new command handler, small refactor
> - **high**: multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
> - **very-high**: architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
>
> Fill `complexity:` with the chosen level and `recommended_models:` with per-agent {model, effort}. Default to the agent's `cli.complexityDefaults[complexity]` values, but override per agent when the feature has asymmetric characteristics (e.g., "the engine changes are judgment-heavy for cc but mechanical for cx — use high-effort cc, medium-effort cx").

The rubric is short, the schema is bounded, and the default is one lookup away — the authoring AI isn't burdened with inventing the recommendation from scratch.

### Fallback chain when the modal opens
1. Spec frontmatter `recommended_models[agent]` (if present and non-null)
2. `cli.complexityDefaults[complexity]` from the agent JSON (if `complexity:` set)
3. `aigon config models` resolution (today's behaviour — env > project > global > default)
4. No flag at all (agent uses its own default)

F291's existing precedence chain becomes the *final* step, not the only step. This layers cleanly on top of F291 without breaking anything.

### Interaction with F291 (dashboard-agent-model-picker)
This feature is a **strict extension** of F291. F291 ships the modal + per-agent model/effort dropdowns + the precedence chain. This feature:
- Adds one data source (spec frontmatter) at the top of the precedence chain
- Adds the "Recommended:" banner at the top of the modal
- Pre-selects the dropdowns from the recommendation

F291 must ship first. No changes to F291's snapshot schema or launch helper — those stay as-is.

### Complexity badge on the backlog card
Small color-coded badge next to the title — green/yellow/orange/red. Makes complexity scannable on the board without opening each spec. Uses the central action/status registry pattern per CLAUDE.md rule 8 (no bespoke frontend logic).

### Spec-review can revise
The spec-review workflow (`afsr`) already produces `spec-review:` commits that edit the spec body. The reviewer's new responsibility: check the complexity rating, revise the frontmatter if wrong, and note the reason in the review commit body. No new commit convention — the existing spec-review commit carries the frontmatter edit.

## Dependencies
- **Hard: F291 (dashboard-agent-model-picker)** — this feature extends F291's modal and precedence chain. F291 must be merged before this starts.
- Soft: F293 (agent-idle-detector-and-spec-preauth) — the pre-auth mechanism established there pairs naturally with complexity in the frontmatter, but not blocking.

## Out of Scope
- Automatic complexity assessment from a static analyser (e.g., "this feature touches 12 files, so complexity=high"). AI-assessed only — static heuristics are orthogonal and not reliably better.
- Complexity-to-model mapping for agents not yet in `templates/agents/` (e.g., opencode). Agent author adds `cli.complexityDefaults` when they add the agent.
- Cost prediction in the modal ("this run will cost ~X tokens"). Useful but speculative; file as a follow-up after seeing frontmatter recommendations in production.
- Rationale text inside the frontmatter (why this complexity rating). Explain in prose; keep frontmatter machine-readable.
- Historical back-fill of complexity on closed features. The flow ships from today forward; closed features stay empty.
- Mandatory frontmatter. Specs without frontmatter keep working exactly as they do today — it's an affordance, not a gate.

## Open Questions
- Should the complexity badge on the backlog card be a small coloured dot, a small text label, or a tooltip-only annotation? (Lean: small text label — "medium" / "high" — with a coloured background. More scannable than a dot, less noisy than a full badge.)
- Should `aigon feature-spec <ID>` (CLI) print the complexity + recommendation at the top of its output so CLI-only operators see the info too? (Lean: yes — small change, high value for CLI workflows.)
- Do we allow `very-high` to imply "do not autopilot" — i.e., disable the "Start Autonomously" action when complexity is very-high? (Lean: no, explicit out-of-scope — that's a policy question for a separate feature. Complexity informs, doesn't gate.)
- Should spec-review fail loudly if the reviewer's complexity assessment differs from the author's (prompting a conversation), or silently revise? (Lean: silent revise with a line in the review summary — "Revised complexity from medium → high because X". Same standard as other review edits.)
- If the authoring AI (say cc) writes a spec but doesn't know what effort values cx accepts (because cc never runs codex), how does it fill cx's recommendation? (Answer: read `cli.complexityDefaults[complexity]` from `cx.json` and use those values verbatim. No per-agent knowledge required from the authoring agent.)

## Related
- Triggered by: 2026-04-21 observation — F293 was recommended "Sonnet + medium" on the basis of a human reading the spec and knowing it was mechanical. That judgment could and should flow from spec-authoring time, where the AI already did the same analysis implicitly.
- **F291 (dashboard-agent-model-picker)** — hard dependency. This feature is a strict extension.
- Precedent: feedback entities use YAML frontmatter for status (per `feedback-*` flow); spec-frontmatter here follows the same pattern.
- CLAUDE.md § Write-Path Contract — frontmatter is a write path; every reader (start modal, CLI `feature-spec`, dashboard card badge) must handle the missing/malformed case.
- CLAUDE.md rule 8 — dashboard action-registry pattern; the "Recommended:" banner and complexity badge must be driven from the central registry, not ad-hoc frontend logic.
