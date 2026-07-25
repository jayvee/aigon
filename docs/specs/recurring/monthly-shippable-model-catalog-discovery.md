---
schedule: monthly
name_pattern: shippable-model-catalog-discovery-{{YYYY-MM}}
recurring_slug: monthly-shippable-model-catalog-discovery
complexity: medium
---

# shippable-model-catalog-discovery-{{YYYY-MM}}

## Summary

Monthly **maintainer catalog build** for OSS `templates/agents/<id>.json` `cli.modelOptions`.
Fetch provider model catalogues (OpenRouter for `op`, Gemini API for `ag`, and any other
agent with a public enumerate endpoint), diff against the current shippable list, and produce
**reviewable recommendations only** — never mutate agent JSON directly.

Outputs:
- `~/src/aigon/.aigon/matrix-refresh/{{YYYY-MM}}/catalog-proposed.json` — structured patch
- `~/src/aigon/.aigon/matrix-refresh/{{YYYY-MM}}/catalog-report.md` — human-readable summary
- One `aigon research-create` (or `feedback-create` if research migration not yet done) per
  distinct recommendation **class** (not per model row)

This complements existing recurring matrix work:
- **weekly** pricing refresh — vendor pricing pages
- **weekly** benchmark — one (agent × model) implement cell
- **quarterly** qualitative refresh — scores and notes
- **monthly (this)** — **new model IDs**, **supersession candidates**, **deprecation / quarantine signals** from live catalogues

## Acceptance Criteria

- [ ] **Repo context:** all catalog reads and proposal writes target the OSS aigon repo at `~/src/aigon` (not this aigon-pro repo). `cd ~/src/aigon` before matrix reads and probe commands.
- [ ] Read current shippable catalog: for each launchable agent with `cli.modelOptions`, load entries via `node -e "const r=require('./lib/agent-registry'); for (const id of ['op','ag','cc','cx','km','cu']) { const o=r.getModelOptions(id,{includeQuarantined:true}); console.log(id, o.length); }"` and capture every `(agentId, value, label, pricing, quarantined, supersededBy, lastRefreshAt)`.
- [ ] **OpenRouter (`op`):** `GET https://openrouter.ai/api/v1/models` (no auth). For each model whose `id` maps to an `openrouter/<id>` value already represented in `op.json` provider families (deepseek, qwen, z-ai, mistralai, x-ai, nvidia, meta-llama, anthropic, …), apply `docs/model-inclusion-policy.md` §1–§3 filters (`tools` in `supported_parameters`, no `:free`-only SKUs, modality exclusions).
- [ ] **Gemini (`ag`):** if `GEMINI_API_KEY` is set, `GET https://generativelanguage.googleapis.com/v1beta/models?key=$GEMINI_API_KEY`; filter `generateContent` + `gemini-*` text models. Skip gracefully with a note in the report if the key is absent.
- [ ] **Manual providers (`cc`, `cx`):** no public enumerate API — note "no auto-discovery" in the report; do not invent entries. Optional: `WebSearch` for release notes only when a community signal suggests a new pinned ID.
- [ ] Classify each diff as one of: `new-model`, `supersession-candidate`, `deprecation`, `pricing-drift`, `tools-regression`, `quarantine-candidate`, `probe-failed`.
- [ ] **Supersession heuristics** (recommendations, not auto-apply): flag `supersession-candidate` when a discovered model appears to replace an active or quarantined catalog entry with the same vendor family and similar economics, e.g. `openrouter/z-ai/glm-5.1` → `openrouter/z-ai/glm-5.2` (same `z-ai/` prefix, successor version, tools-capable, list price within 2× of predecessor). Include `supersedes: "<old value>"` in the patch entry.
- [ ] For every `new-model` and `supersession-candidate` where the agent supports headless probe (`op`, `cc`, `cx`, `ag`), run `aigon agent-probe <agentId> --model <value>` from `~/src/aigon`. Record PASS/FAIL/TIMEOUT in the report; downgrade to `probe-failed` when not PASS.
- [ ] Write `catalog-proposed.json` (format below) and `catalog-report.md` under `~/src/aigon/.aigon/matrix-refresh/{{YYYY-MM}}/`.
- [ ] Create one triage item per recommendation **class** present (e.g. one research for all `new-model`, one for all `supersession-candidate`) with links to both output files.
- [ ] Commit from `~/src/aigon`: `git add .aigon/matrix-refresh/{{YYYY-MM}}/ && git commit -m "chore: monthly shippable model catalog discovery {{YYYY-MM}}"` — **do not** commit `templates/agents/*.json` changes in this recurring pass.
- [ ] Close this feature when outputs are committed (no eval step).

If the diff is empty after filtering, write `changes: []`, a one-paragraph "no material catalog changes" report, skip triage creation, and close.

## Patch File Format (`catalog-proposed.json`)

```json
{
  "month": "{{YYYY-MM}}",
  "generatedAt": "<ISO timestamp>",
  "ossRepo": "~/src/aigon",
  "sources": {
    "openrouter": "https://openrouter.ai/api/v1/models",
    "gemini": "<URL or skipped>"
  },
  "changes": [
    {
      "triageId": "<research or feedback id>",
      "changeKind": "supersession-candidate",
      "agentId": "op",
      "modelValue": "openrouter/z-ai/glm-5.2",
      "supersedes": "openrouter/z-ai/glm-5.1",
      "patch": {
        "newModel": true,
        "label": "GLM 5.2 via OpenRouter",
        "pricing": { "input": 0.95, "output": 3.0 },
        "quarantinePredecessor": {
          "since": "{{YYYY-MM-DD}}",
          "reason": "Superseded by glm-5.2",
          "supersededBy": ["openrouter/z-ai/glm-5.2"]
        }
      },
      "probe": { "verdict": "PASS", "elapsedMs": 8400 },
      "rationale": "OpenRouter lists z-ai/glm-5.2 with tools; predecessor quarantined; probe PASS.",
      "policyGates": ["§1 modality OK", "§3 tools OK", "§5 fields pending human score"]
    }
  ]
}
```

Valid `changeKind` values:
- `new-model` — ID not in catalog; eligible per inclusion policy
- `supersession-candidate` — new ID should replace an older same-family entry
- `deprecation` — catalog model absent from provider catalogue or marked EOL
- `pricing-drift` — API pricing differs from catalog by >10% (operator may fold into weekly pricing refresh instead)
- `tools-regression` — catalog model no longer reports `tools` support on OpenRouter
- `quarantine-candidate` — probe FAIL/TIMEOUT or repeated bench failure signal
- `probe-failed` — looked promising but failed `aigon agent-probe`

## Technical Approach

### Provider coverage

| Agent | Discovery source | Auto? |
|-------|------------------|-------|
| `op` | OpenRouter `/api/v1/models` → `openrouter/<id>` values | Yes |
| `ag` | Gemini v1beta models list | Yes (needs `GEMINI_API_KEY`) |
| `cc` | Anthropic docs / release notes | Manual signal only |
| `cx` | OpenAI docs / release notes | Manual signal only |
| `km`, `cu` | Agent JSON `providerFamily` + web search | Manual signal only |

Scope OpenRouter discovery to **provider prefixes already present** in `templates/agents/op.json` unless a research item explicitly authorises expanding coverage.

### Workflow

1. `cd ~/src/aigon`.
2. Snapshot current `modelOptions` (include quarantined for supersession analysis).
3. Fetch catalogues; normalise IDs to Aigon `value` strings (`openrouter/` prefix for op).
4. Run inclusion-policy gate checks (read `docs/model-inclusion-policy.md` in aigon).
5. Diff → classify → probe candidates → write JSON + markdown report.
6. Create triage items; commit **only** `.aigon/matrix-refresh/{{YYYY-MM}}/`.

### Applying approved changes (operator, not this agent)

After human review, approved rows ship to OSS catalog via maintainer workflow:
- Hand-edit `templates/agents/<id>.json` following `docs/model-inclusion-policy.md` §0, **or**
- Future Pro `matrix-apply` / `bench-refresh --dry-run` tooling when restored in aigon-pro

Cross-repo implementation note: restoring `discoverOpModels` + `bench-refresh` as **Pro-only** CLI (F503 discovery half, F537 relocation) is a separate aigon-pro feature; this recurring spec is intentionally **agent-executable today** without waiting for that CLI.

## Pre-authorised

- May fetch `https://openrouter.ai/api/v1/models` without additional confirmation
- May use `GEMINI_API_KEY` for Gemini model enumeration when set
- May run `aigon agent-probe` for any candidate model (OpenRouter spend is operator-billed)
- Skip eval step: recommendations are reviewed by maintainer before catalog mutation
- May commit only `.aigon/matrix-refresh/{{YYYY-MM}}/` under `~/src/aigon`

## Related

- OSS policy: `~/src/aigon/docs/model-inclusion-policy.md`
- Retired OSS discovery: F503 `bench-refresh`, removed from user surface F537
- Matrix recurring family: `weekly-agent-matrix-pricing-refresh.md`, `quarterly-agent-matrix-qualitative-refresh.md`
- Example supersession: GLM 5.1 → 5.2 in `templates/agents/op.json`
