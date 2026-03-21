# Feature: deploy-demo-update

## Summary

Update the Ralph demo terminal animation to show the full end-to-end workflow including `--auto-submit` and `aigon deploy`, reflecting the commands added in aigon v2.29.x.

## User Stories

- [ ] As a visitor watching the Ralph demo, I want to see the complete workflow from feature creation through to deployment, so I understand what aigon automates end-to-end

## Acceptance Criteria

- [x] The Ralph demo input command changes from `aigon feature-now dark-mode --ralph` to `aigon feature-now dark-mode --ralph --auto-submit`
- [x] After the Ralph success lines, the demo shows `aigon feature-done 08` as the next input with a brief completion output line
- [x] After feature-done, the demo shows `aigon deploy` as input followed by `✓  Deployed to production`
- [x] The demo still feels natural — no more than 3-4 new lines added total

## Validation

```bash
grep -c "aigon deploy" index.html
```

## Technical Approach

Edit the `<template id="demo-ralph">` block in `index.html` (around line 505):
- Change the input line to add `--auto-submit`
- Replace the final `Ready for review` output line with:
  - A blank spacer line
  - `aigon feature-done 08` input line
  - `✓  Merged to main` output line
  - `aigon deploy` input line
  - `✓  Deployed to production` output line

Use `lineDelay` values consistent with the existing demo pacing.

## Dependencies

- `index.html` — only file that changes

## Out of Scope

- Updating other demo templates
- Adding a deploy section to the nav or docs

## Open Questions

-

## Related

- aigon v2.29.x: feature 36 (deploy), feature 35 (--auto-submit)
