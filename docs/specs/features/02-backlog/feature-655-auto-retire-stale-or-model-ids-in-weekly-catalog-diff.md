---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T00:47:17.269Z", actor: "cli/feature-prioritise" }
---

# Feature: auto-retire stale OR model IDs in weekly catalog diff

## Summary
The weekly model-catalog diff currently identifies OpenRouter model IDs that disappeared, changed tool support, or are superseded by newer variants, but stale IDs can remain as selectable `op` model options until a maintainer manually notices and edits `templates/agents/op.json`. Add an explicit retire-candidate output from the weekly catalog diff that proposes `quarantined` or `archived` blocks for stale OpenRouter IDs, with evidence, while keeping the final registry mutation reviewable.

## User Stories
- [ ] As the maintainer refreshing the `op` model catalog, I get a concrete list of stale/superseded model IDs with recommended registry actions instead of manually scanning the diff.
- [ ] As an Aigon user opening the model picker, stale OpenRouter IDs stop lingering as green choices after the next curated catalog refresh.
- [ ] As a reviewer, I can trace every quarantine/archive recommendation to catalog evidence and prior Aigon metadata before it is applied.

## Acceptance Criteria
- [ ] The weekly catalog diff output classifies each existing `templates/agents/op.json` model option as `active`, `retire-candidate`, `archive-candidate`, or `unchanged`, based on provider catalog presence, tool-support status, and supersession evidence.
- [ ] For each retire/archive candidate, the output includes the model `value`, current label, recommended action, reason, evidence source, and proposed `quarantined` or `archived` block shape.
- [ ] The feature does not silently delete model options. Registry changes remain explicit reviewable edits to `templates/agents/op.json`.
- [ ] Existing quarantined/archived entries are short-circuited unless new evidence changes their reason or supersession target.
- [ ] The output format is stable enough for a maintainer to paste into an implementation log or apply manually.
- [ ] Tests cover at least: missing provider ID, provider ID present but no tool support, superseded-by newer ID, already-quarantined unchanged, and active unchanged.

## Validation
```bash
node --check lib/agent-registry.js
npm run test:core
```

## Technical Approach
- Find the current weekly catalog diff surface from F617/model-catalog-intelligence before adding new code. If the executable maintainer tooling now lives in `aigon-pro`, implement the generation there and keep only the curated registry contract in OSS.
- Reuse existing registry validation for `quarantined` / `archived` metadata; do not introduce a second schema.
- Keep OSS user surfaces read-only, consistent with F537: no public `model-refresh`, `bench-refresh`, or `matrix-apply` command should return.

## Dependencies
- F537 split maintainer benchmarking/catalog tooling out of the OSS user command surface.
- F617 weekly model catalog intelligence.

## Out of Scope
- Reintroducing removed OSS maintainer commands.
- Running benchmarks or probes.
- Automatically committing registry edits without review.
- Model recommendations for non-OpenRouter agents.

## Open Questions
- Should the retire-candidate artifact be committed in OSS, written under `.aigon/`, or kept entirely in the Pro/internal maintainer repo? Prefer Pro/internal unless an OSS release artifact is deliberately curated.

## Related
- Prior work: F537, F617, model inclusion policy in `docs/model-inclusion-policy.md`.
