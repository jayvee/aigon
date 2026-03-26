# Feature: model-config-update-cx

## Summary

Update the Codex CLI agent config (`templates/agents/cx.json`) to use `gpt-5.4` as the implementation model instead of `gpt-5.3-codex`. Research 21 found that GPT-5.4 offers a quality improvement for a modest cost increase ($1.75 → $2.50/MTok input). The evaluate model already uses `gpt-5.4`, so this aligns implement with evaluate.

## User Stories

- [ ] As a user, I want cx to use the best available GPT model for implementation so Fleet results are competitive with cc and gg

## Acceptance Criteria

- [ ] `templates/agents/cx.json` `cli.models.implement` changed from `gpt-5.3-codex` to `gpt-5.4`
- [ ] Any generated files that reference the cx implement model are updated on next `aigon install-agent cx`
- [ ] No other agent configs are changed

## Validation

```bash
node -c lib/config.js
grep -q '"implement": "gpt-5.4"' templates/agents/cx.json
```

## Technical Approach

Single-line change in `templates/agents/cx.json`. Run `aigon install-agent cx` afterward to regenerate any files that reference the model.

## Dependencies

- None

## Out of Scope

- Changing research or evaluate models
- Benchmarking the quality difference

## Open Questions

- None

## Related

- Research: #21 coding-agent-landscape
