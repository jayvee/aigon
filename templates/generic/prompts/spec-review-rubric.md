## Spec Review Rubric

Review the spec against this checklist. Prefer small, targeted edits over broad rewrites.

### Specificity
- Replace vague language with concrete behavior, constraints, and outcomes.
- Name exact commands, files, states, and data shapes where they matter.

### Completeness
- Ensure the happy path, error path, and lifecycle edge cases are covered.
- Call out missing UX states, integration seams, or follow-up commits/tests the spec requires.

### Testability
- Acceptance criteria should be observable and falsifiable.
- Prefer criteria that can be checked with a command, visible UI state, or concrete artifact.

### Scope clarity
- Remove work that belongs in a follow-up feature.
- Flag hidden expansion of scope, especially cross-cutting dashboard or infra work.

### Understandability
- Tighten structure so implementation order and ownership are obvious.
- Eliminate ambiguity about which module or layer should own the change.

### Consistency
- Align with existing Aigon patterns: centralized action rules, ctx usage, template source-of-truth, and workflow-core authority.
- Avoid introducing a second source of truth or frontend-only eligibility logic.

### Minimal-diff preference
- Edit in place.
- Keep valid author intent.
- Strengthen the spec without rewriting its voice unless the original wording is actively harmful or unclear.

### Frontmatter: complexity + recommended models (F313)
- Verify `complexity:` matches the spec's actual scope + risk + judgment-load using the rubric (low / medium / high / very-high).
  - **low** config/doc/single-file; **medium** standard cross-cutting; **high** multi-file engine/event/dashboard; **very-high** architectural shifts.
- If the author over- or under-rated complexity, revise the value. Note the revision (old → new) in the review commit's Summary and give the reason in one line.
- Check `recommended_models`: per-agent entries either stay `{ model: null, effort: null }` (inherit `cli.complexityDefaults`) or justify an asymmetric override in the Technical Approach prose. Strip bogus overrides; keep deliberate ones.
- Frontmatter edits ship in the same `spec-review:` commit as other edits.
