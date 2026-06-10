---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-10T01:55:27.340Z", actor: "cli/feature-prioritise" }
---

# Feature: add-fable-5-model

## Summary

Add `claude-fable-5` to the `cli.modelOptions` array in `templates/agents/cc.json` so it appears in the Model dropdown wherever Claude is selected as the agent. Also document the maintainer process for adding new models to agent configs, since no such guide currently exists.

## User Stories

- [ ] As an Aigon user with Claude as my agent, I can select Fable 5 from the Model dropdown in the start modal for any feature or research task.
- [ ] As an Aigon maintainer, I can follow a documented, step-by-step guide in `docs/adding-models.md` to add future Anthropic (or other) models to an agent's `cli.modelOptions` without violating the model-inclusion policy.

## Acceptance Criteria

- [ ] `templates/agents/cc.json` contains a new entry in `cli.modelOptions` for `claude-fable-5` with:
  - `value: "claude-fable-5"`
  - `label: "Fable 5"`
  - `pricing: { input, output }` in USD/MTok (use published pricing; leave as `null` if unavailable)
  - `score: { spec_review: null, implement: null, review: null, spec: null, research: null }` (null until qualified)
  - `notes: { <role>: string }` — at minimum a one-sentence placeholder per role indicating it is newly added and unqualified
  - `lastRefreshAt` — ISO timestamp of this addition
- [ ] A companion entry for `"claude-fable-5[1m]"` (1M context variant) is added following the same pattern as existing `[1m]` variants, if Fable 5 supports extended context.
- [ ] Neither Fable 5 nor Fable 5 (1M) is set as a default in `cli.complexityDefaults` — that promotion requires a scored eval pass.
- [ ] `docs/adding-models.md` is created with a maintainer guide covering:
  - When a model is eligible (point to `docs/model-inclusion-policy.md`)
  - The required fields for a `modelOptions` entry (value, label, pricing, score, notes, lastRefreshAt)
  - How to add the entry to the correct `templates/agents/<id>.json`
  - How to restart the server after editing agent JSON (`aigon server restart`)
  - When to promote a model into `cli.complexityDefaults` (after a scored eval)
  - How to quarantine a broken model without deleting it
- [ ] `aigon server restart` succeeds after the JSON edits (no parse errors).
- [ ] The new model appears in the dashboard start-modal Model dropdown when cc is the agent.
- [ ] A lightweight benchmark is run using `claude-fable-5` on a real Aigon feature task (e.g. a low-complexity inbox spec) and the results are noted in the implementation log — specifically: did it complete, any errors, qualitative implement quality. This is not a formal score; it is an existence-and-sanity check.

## Validation

```bash
node -e "JSON.parse(require('fs').readFileSync('templates/agents/cc.json','utf8'))" && echo "JSON valid"
aigon server restart
```

## Technical Approach

This is a config-only change on the aigon side:

1. Read `templates/agents/cc.json` — locate the `cli.modelOptions` array.
2. Insert the `claude-fable-5` entry after the last non-quarantined Opus entry (maintain descending capability order: Opus > Sonnet > Haiku; Fable 5 is Anthropic's most capable model so it goes at or near the top of the active entries).
3. Use `lastRefreshAt` equal to today's date (ISO format).
4. Set all `score` fields to `null` — they are filled by a scored eval sweep, not by this spec.
5. Write placeholder `notes` that name the model and state "newly added, unqualified".
6. Repeat for the `[1m]` variant if Fable 5 supports extended context (check the Anthropic docs or API; if unsure, add with a note).
7. Do **not** touch `cli.complexityDefaults` — Fable 5 will route there only after a scored eval.
8. After the JSON edit, run `aigon server restart` and take a Playwright snapshot confirming the model appears in the start-modal dropdown.
9. Write `docs/adding-models.md` as a short practitioner guide (≤ 150 lines) referencing `docs/model-inclusion-policy.md` for the policy rationale.
10. Run a quick smoke benchmark: start a low-complexity inbox feature using `--model claude-fable-5`, let it complete one iteration, record whether it completed successfully and any qualitative notes in the implementation log. No automated scoring required.

**JSON entry placement:** Insert Fable 5 entries before the first Opus entry (or at the top of the array after `Default`), since Fable 5 is Anthropic's top tier as of the knowledge cutoff.

**Do not delete or modify any quarantined entries** — this is enforced by the model inclusion policy.

## Dependencies

- None. This is a standalone config + doc change.

## Out of Scope

- Promoting Fable 5 to `cli.complexityDefaults` (requires scored eval).
- Automated benchmarking infrastructure.
- Adding Fable 5 to non-cc agent configs (gg, cx, etc.).
- Modifying the model-inclusion policy itself.

## Open Questions

- Does `claude-fable-5` accept the `--model claude-fable-5` flag in Claude Code CLI today, or does the CLI require a specific alias/ID?
- Does Fable 5 support the 1M context variant (`[1m]` suffix in Claude Code)?
- What is the published pricing for Fable 5 (input/output USD/MTok)?

## Related

- `docs/model-inclusion-policy.md` — policy governing what may appear in `cli.modelOptions`
- `templates/agents/cc.json` — the file being edited
