---
complexity: medium
---

# Research: complexity → model defaults (tuning & policy)

## Context

An earlier draft of this topic assumed Aigon had a single fixed model per agent and needed a greenfield design for complexity metadata and start-time recommendations. **That work is largely shipped (F313):**

- **Feature specs** are created from `templates/specs/feature-template.md`, which includes YAML frontmatter with `complexity:` (`low` \| `medium` \| `high` \| `very-high`) only. Model names do not belong in the spec.
- **`feature-create` instructions** (`templates/generic/commands/feature-create.md`) require the authoring agent to set `complexity:` using the rubric in the template.
- **Per-agent mapping** lives in `templates/agents/{cc,cx,gg,cu}.json` under `cli.complexityDefaults[<complexity>]` → default `{ model, effort }` for that tier.
- **Resolution** is implemented in `lib/spec-recommendation.js`: `complexityDefaults` for the spec’s complexity → caller falls back to `aigon config models`. The dashboard consumes this via `/api/recommendation/:type/:id` and pre-selects the start modal.

Users can still pick a specific model at start time; recommendations are defaults, not locks.

**What this research should cover instead** is whether the *defaults* and *process* are right: ladder tuning per provider, gaps (e.g. agents without `complexityDefaults`), org/repo policy, and whether `complexity` is reliably present and accurate on real specs.

## Questions to Answer

### Preconditions (is `complexity` actually on specs?)
- [ ] In practice, what share of feature specs in the wild have valid `complexity:` in frontmatter vs missing/invalid/stale?
- [ ] If gaps are common, is the fix **process** (stronger prompts, spec-review checks) or **product** (lint on prioritise, dashboard warning, `doctor` hint) — and what is the minimal enforcement that avoids silent wrong-tier defaults?

### Mapping quality (agent model ↔ complexity tier)
- [ ] Are the current `complexityDefaults` tables in each agent JSON appropriate for cost vs quality (including model renames and new SKUs)?
- [ ] Which agents lack `complexityDefaults` today (e.g. OpenCode / other harness-only agents), and should they get explicit ladders or documented “N/A” behavior?
- [ ] Should **implement**, **evaluate**, and **review** tasks use the same ladder or different rows (today the recommendation is primarily start/implement-shaped; document actual behavior in code paths)?

### Recommendation policy
- [ ] Should teams be able to set **repo-level** or **profile-level** floor/ceiling on model tier (e.g. “never below Sonnet for cc”) without editing every spec?
### Validation (optional evidence)
- [ ] Can we cheaply benchmark wrong-tier outcomes (e.g. same canned task at low vs high tier) or is qualitative review sufficient for the first iteration?

## Scope

### In Scope
- Auditing real spec frontmatter and default tables; proposing concrete changes to `templates/agents/*.json` and/or docs.
- Policy and enforcement options for missing `complexity`.
- Any small, evidence-backed adjustments to the feature-create rubric.

### Out of Scope
- Re-introducing per-agent model IDs into spec frontmatter (complexity-only is intentional).
- Automatic mid-session model switching.
- Full cost-accounting product work (cross-link observability research if needed).

## Inspiration
- `lib/spec-recommendation.js` — resolver and `ALLOWED_COMPLEXITY`
- `templates/specs/feature-template.md` — canonical frontmatter
- `templates/agents/cc.json` (and cx/gg/cu) — `cli.complexityDefaults`
- `templates/generic/commands/feature-create.md` — authoring instructions
- Dashboard: `/api/recommendation/:type/:id` (see `lib/dashboard-routes.js` or collector wiring)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
