---
set: feature-set
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-22T22:45:58.062Z", actor: "cli/feature-prioritise" }
---

# Feature: feature-set-2-research-eval-emit-metadata

## Summary
Extend `research-eval` so that when an evaluation produces multiple related features, it proposes a set slug (derived from the research topic name) and optionally stamps the `set:` frontmatter key onto each created feature spec. This closes the loop between "research evaluation produces a cluster of features" (the common case that motivated research 34 in the first place) and the new set-membership abstraction from feature-set-1 — without forcing automatic grouping on users who would rather leave features ungrouped.

## User Stories
- [ ] As a user running `research-eval` and selecting 3+ features to create, I see a proposed set slug and members and can accept/edit/decline before features are created.
- [ ] As a user who accepted the proposed set, every created feature spec has the `set: <slug>` key already stamped in its frontmatter — no manual post-edit needed.
- [ ] As a user who declined, features are created without the `set:` key (no drift, no silent tagging).
- [ ] As a user re-running `research-eval` on the same topic, the prompt remembers the previously chosen slug so re-created features rejoin the same set.

## Acceptance Criteria
- [ ] `templates/generic/commands/research-eval.md` is updated so agents always propose a set slug derived from the research topic (matching the existing "feature set naming" section that already suggests a common prefix — this formalizes the `set:` frontmatter tag that goes with it).
- [ ] When the user selects 2+ features, the evaluation prompt asks for explicit opt-in: "Group these as set `<slug>`? (y/n/edit slug)".
- [ ] `aigon feature-create` accepts an optional `--set <slug>` flag that stamps `set:` into the new spec's frontmatter at creation time.
- [ ] The research evaluation's `## Output` section records the chosen set slug alongside the selected features table, so the decision is preserved in the research log.
- [ ] If the user declines, no `set:` key is written anywhere. No "auto" mode — the default behavior without the opt-in is identical to today.
- [ ] Tests cover: `feature-create --set foo` frontmatter output, and a template snapshot test for the updated `research-eval.md` prompt sections.

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
- **Template change only** for the prompt: the agent running `research-eval` is the one that proposes the slug and writes `set:` into frontmatter via `feature-create --set <slug>`. No new engine logic on the research side.
- **CLI change**: extend `lib/commands/feature.js` `feature-create` to accept `--set <slug>` and thread it into the spec-template render.
- **Default disposition**: opt-in prompt, not auto-tag. This is the deliberate divergence resolution between gg (auto) and cc (opt-in only) — we go with cc's position because sets are a user decision with real downstream consequences (grouping, future autonomous batching) and silent tagging could surprise users.
- **Slug derivation**: lowercased research topic slug trimmed of leading "research-<id>-"; user can edit before acceptance.

## Dependencies
- depends_on: feature-set-1-membership-and-board

## Out of Scope
- Retroactive tagging of features created before the set was named (user can still manually add `set:` to frontmatter)
- Auto-emission without user opt-in (explicitly rejected by the research findings)
- Cross-repo set tagging when research spans aigon + aigon-pro

## Open Questions
- Should the opt-in prompt default to yes (one keystroke to accept) or no (explicit action required to tag)? Leaning yes — it matches the research recommendation where 3+ related features are the common output.
- Should the research log also record the *declined* state so re-eval doesn't re-propose the same slug?

## Related
- Research: #34 feature-set
