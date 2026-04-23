---
complexity: medium
recommended_models:
  cc: { model: null, effort: null }
  cx: { model: null, effort: null }
  gg: { model: null, effort: null }
  cu: { model: null, effort: null }
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-23T07:31:02.171Z", actor: "cli/feature-prioritise" }
---

# Feature: per-feature set review agent for set autonomous

## Summary

Today `aigon set-autonomous-start` accepts a single **set-level** `--review-agent=<id>`; every member feature in the set receives that same reviewer when `set-conductor` calls `feature-autonomous-start`. The dashboard "Set autonomous" flow already passes one optional reviewer for the whole set.

**This feature** adds an optional **per-member** override: feature specs that belong to a set may declare, in YAML frontmatter, which agent should run the code-review phase for that feature during a set autonomous run. When present and valid, it wins over the set-level `--review-agent` for that member only; when absent, behavior stays as today (set-level flag, or no review if unset).

This matches how different features in a set can need different review expertise (e.g. security vs. UX) without running separate one-off `feature-autonomous-start` invocations from the feature row.

## User Stories

- [ ] As an operator, I can put `set_review_agent: cx` in one feature’s frontmatter and `set_review_agent: cc` in another, both in the same set, and the set runner uses those reviewers for each feature’s review step.
- [ ] As an operator, I can omit `set_review_agent` on a spec and still rely on the **single** dashboard/CLI `--review-agent` for the whole set, unchanged from current behavior.
- [ ] As an operator, I get a **loud, documented failure** if a declared `set_review_agent` is not a valid agent id (no silent skip); repair path cites `aigon config` / agent list as today for invalid agents.

## Acceptance Criteria

- [ ] Feature spec YAML supports optional `set_review_agent: <agentId>` (same token rules as `aigon` agent ids used elsewhere: registry-known implementer or review-capable id — align with `feature-autonomous-start --review-agent` validation).
- [ ] `set-conductor` (or a small helper next to `lib/feature-sets.js`) **resolves the effective review agent** when starting each member: `perFeatureOverride ?? setLevelReviewAgent` (both may be null → no review step for that member).
- [ ] Resolution uses the **current on-disk spec** for that feature id (path from existing set membership / `feature-sets` index), not cached stale data, so edits between members take effect.
- [ ] `set-autonomous-resume` continues to behave correctly: persisted set state does not need to store per-feature review agents if the resolver re-reads frontmatter on each `startFeatureAutonomous` (document this invariant in code comment).
- [ ] Integration or unit test covers: member A with frontmatter override, member B without → A gets override, B gets set-level default; third case: no set-level, only A has frontmatter → A reviewed, B not.
- [ ] `npm test` passes; new tests name the regression in a `// REGRESSION:` comment.
- [ ] `docs/development_workflow.md` and/or `site/content/reference/configuration.mdx` gain a short row documenting `set_review_agent` (if those files already document `set:` — add adjacent).

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May add up to +60 LOC in `scripts/check-test-budget.sh` total test tree if new tests are strictly needed for the resolver and cannot fold into an existing file without obscuring intent.

## Technical Approach

1. **Frontmatter**  
   - Extend parsing in one place: either alongside `readSetTag` in `lib/feature-sets.js` (export `readSetReviewAgentTag(content)`) or a tiny `lib/set-spec-helpers.js` to avoid `feature-sets` growing unrelated concerns.  
   - Invalid YAML values → fail the **start** of that member (set pauses or exits with message), not the dashboard read path: match write/read contract; no half-state for set runs.

2. **Set conductor**  
   - In `startFeatureAutonomous`, accept optional `reviewAgent` as today; **caller** computes:  
     `resolved = readOverride(featureId) ?? setLevelReviewAgent`  
   - `runLoop` already has `reviewAgent` from CLI; when iterating members, pass resolved value per member.

3. **Registry**  
   - Reuse the same allow-list used by `feature-autonomous-start` for `--review-agent` so the engine does not accept arbitrary strings.

4. **Dashboard (optional in same PR or follow-up)**  
   - If trivial: show "Reviewer: (per spec)" in tooltips when override exists; not blocking for MVP — CLI correctness first.

5. **Docs**  
   - One paragraph under feature-set / frontmatter section pointing to `set:` and the new key.

## Dependencies

-

## Out of Scope

- Per-feature **implementer** list overrides for set runs (already comes from `feature-start` / workflow state).  
- Multiple reviewers per feature in one run.  
- Research entities or non-feature specs.

## Open Questions

- None: `set_review_agent` as the YAML key name (snake_case, consistent with `depends_on:` pattern in feature frontmatter).

## Related

- `lib/set-conductor.js` — `startFeatureAutonomous`, `options.reviewAgent`  
- `lib/feature-sets.js` — `set:` tag scanning; pattern for reading extra keys  
- `lib/feature-autonomous.js` — `--review-agent` behavior for solo features  
- Prior art: dashboard set modal passes `--review-agent` for the whole set only
