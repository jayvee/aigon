---
recurring_slug: weekly-agent-matrix-pricing-refresh
complexity: low
recurring_week: 2026-W18
recurring_template: weekly-agent-matrix-pricing-refresh.md
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T14:13:22.206Z", actor: "recurring/feature-prioritise" }
---

# agent-matrix-pricing-refresh-2026-W18

## Summary

Scan vendor pricing pages and release notes to detect changes since the last matrix refresh.
Produce a reviewable patch file at `.aigon/matrix-refresh/2026-04-26/proposed.json` and
one `aigon feedback-create` per detected change-kind. Never mutates agent registry files directly.

## Acceptance Criteria

- [ ] Read the current matrix: `node -e "const m=require('./lib/agent-matrix'); console.log(JSON.stringify(m.buildMatrix(),null,2))"` and note every `(agentId, modelValue, pricing)` triple and `lastRefreshAt`
- [ ] For each provider family, use `WebSearch` then `WebFetch` to retrieve current pricing from the canonical pricing page (see Technical Approach for URLs)
- [ ] Diff current matrix pricing against fetched prices; identify any: `pricing-update`, `new-model`, `deprecation`, `quarantine-candidate`
- [ ] Write `.aigon/matrix-refresh/2026-04-26/proposed.json` with the structured patch (see format below)
- [ ] For each distinct change-kind detected, run one `aigon feedback-create "<change-kind>: <brief description>"` — include the patch file path in the feedback body
- [ ] Commit: `git add .aigon/matrix-refresh/ && git commit -m "chore: agent-matrix pricing refresh 2026-04-26"`
- [ ] Close this feature (no eval step needed)

If no changes are detected, write an empty `changes: []` patch file and skip feedback creation.

## Patch File Format

```json
{
  "date": "2026-04-26",
  "sources": {
    "anthropic": "<URL fetched>",
    "google": "<URL fetched>",
    "openai": "<URL fetched>"
  },
  "changes": [
    {
      "feedbackId": "<feedback item ID, e.g. 42>",
      "changeKind": "pricing-update",
      "agentId": "cc",
      "modelValue": "claude-sonnet-4-6",
      "patch": {
        "pricing": { "input": 3.00, "output": 15.00 }
      },
      "rationale": "One sentence from the vendor page"
    }
  ]
}
```

Valid `changeKind` values:
- `pricing-update` — input or output price changed
- `new-model` — a model not yet in the registry appeared on the pricing page
- `deprecation` — a model in the registry was listed as deprecated/legacy/removed
- `quarantine-candidate` — repeated public reports of quality regression or capability loss

Valid top-level `patch` fields (applied to the matching `modelOptions` entry):
- `pricing` — `{ input: <$/M>, output: <$/M> }` — update input/output price
- `label` — string — rename the label
- `quarantined` — `{ at: "<ISO date>", reason: "<string>" }` — mark quarantined
- `deprecated` — `true` — set a `deprecated: true` field (used for display; does not remove)
- `newModel` — `true` — signals `matrix-apply` to insert a new modelOption entry; must also include `label`, `pricing`

## Technical Approach

### Vendor pricing pages to check

| Provider | Agent IDs | Canonical URL |
|----------|-----------|---------------|
| Anthropic | cc | https://www.anthropic.com/pricing |
| Google | gg | https://ai.google.dev/pricing |
| OpenAI | cx | https://openai.com/api/pricing/ |
| Other/unknown | cu, km, op | Check agent JSON `providerFamily` and search `<providerFamily> api pricing` |

### Workflow

1. Run the matrix read command above to capture current state.
2. For each provider, `WebSearch` for "<provider> api pricing <current year>" to confirm the canonical page, then `WebFetch` it.
3. Extract model IDs and prices from the fetched page. Match against the matrix using `modelValue`.
4. Classify each discrepancy as one of the four change-kinds above.
5. Write the patch file. Each change entry needs a `feedbackId` — create the feedback items first, then fill in their IDs.

### Creating feedback items

Run one `aigon feedback-create` per change-kind, not per individual model. Use a title like:
- `pricing-update: Anthropic raised Sonnet 4.6 input price to $3.50/M`
- `new-model: Google Gemini 2.5 Ultra not in matrix`
- `deprecation: Gemini 1.5 Flash listed as legacy on Google pricing page`
- `quarantine-candidate: Public reports of Claude Opus 4.5 quality regression`

In the feedback body, include:
- The patch file path: `.aigon/matrix-refresh/2026-04-26/proposed.json`
- The specific `changeKind` entry from the patch
- Source URL and date

### Applying approved changes

Changes are applied by the operator (not by this refresh agent) using:
```bash
aigon matrix-apply <feedback-id>
```

This command reads the patch file, finds the entry with the matching `feedbackId`, and writes
the change to `templates/agents/<agentId>.json`.

## Pre-authorised

- Skip eval step: this is a data-collection task; quality judgement comes from the operator reviewing the feedback items, not a separate eval agent
- May run `node -e "..."` to read the matrix without additional confirmation

## Related

- Matrix collector: `lib/agent-matrix.js`
- Apply command: `aigon matrix-apply <feedback-id>`
- Feedback system: `lib/commands/feedback.js`
- Set: agent-matrix (features 370–376)
