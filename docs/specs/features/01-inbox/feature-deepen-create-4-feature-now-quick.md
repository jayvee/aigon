---
complexity: low
research: 46
set: deepen-create
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T23:21:54.410Z", actor: "cli/feature-prioritise" }
---

# Feature: deepen-create-4-feature-now-quick

## Summary

`feature-now` is the fast-track command that creates, sets up, and starts a feature in one step. The "type a name, walk away" ergonomic only works if there is no interactive interview interrupting the chain. After feature #3 makes deepen default-on, `feature-now`'s chained `feature-create` call must pass `--quick` so the fast path stays fast.

This is a one-line ergonomic fix. Without it, the deepen rollout would silently break the most-used express path.

## User Stories

- [ ] As a user running `aigon feature-now "add saml auth"`, the command does not stop to interview me — it scaffolds, prioritises, and starts the feature exactly as it does today, even with deepen default-on.
- [ ] As a user, if I want a deepened spec from a fast-track flow, I run the standard `feature-create` instead — `feature-now` is explicitly the no-interview path.

## Acceptance Criteria

- [ ] The `feature-now` command (in `lib/commands/feature.js` or wherever `feature-now` lives — verify the path before editing) invokes its internal `feature-create` step with `--quick`.
- [ ] Documentation for `feature-now` explicitly states that the fast-track path skips the deepen interview, and points to plain `feature-create` for users who want the interview.
- [ ] The slash command template for `feature-now` (under `templates/generic/commands/`) reflects the same — no deepen step appears in the chained instructions.
- [ ] No regression in `feature-now`'s existing behavior: still creates, prioritises, sets up, and starts in one go.

## Validation

```bash
node -c aigon-cli.js
# Smoke: feature-now should complete non-interactively even with deepen default-on
aigon feature-now "smoke-test-now-quick" --dry-run 2>&1 | grep -i quick
```

## Technical Approach

- Locate the chained `feature-create` invocation inside the `feature-now` implementation (`lib/commands/feature.js` is the likely home given memory's architecture notes).
- Add `--quick` to the invocation. If `feature-now` shells out to `aigon feature-create` it's a literal flag; if it calls the handler in-process, pass the equivalent option object key.
- Update the slash command template and any user-facing help text to reflect that fast-track skips deepen.
- One-paragraph note in the spec for #3 might already cover this; do not duplicate config logic here. This feature only touches the call site.

## Pre-authorised

- May skip `npm run test:ui` mid-iteration — this feature touches no dashboard assets.

## Dependencies

- depends_on: deepen-create-3-toggle-and-quick-flag

## Out of Scope

- The `--quick` flag itself — implemented in feature #3.
- Any deepen interview prompt content — features #1 and #2.
- A research equivalent of `feature-now` — does not exist today.

## Open Questions

- None — this is a small, well-defined wiring change.

## Related

- Research: #46 guided-entity-creation
- Set: deepen-create
- Prior features in set: deepen-create-1-feature-prompt, deepen-create-2-research-prompt, deepen-create-3-toggle-and-quick-flag
