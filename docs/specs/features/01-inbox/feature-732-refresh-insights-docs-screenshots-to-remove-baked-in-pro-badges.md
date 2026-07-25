---
aigon_id: F732
complexity: low
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
# set: my-slug  # optional — ONLY when creating 2+ inbox peers to ship together.
#              #   Run `aigon set list` / `aigon set show <slug>` first. NEVER tag into
#              #   a completed set (all members done). Follow-up work: standalone + depends_on.
---

# Feature: refresh insights docs screenshots to remove baked-in PRO badges

## Summary

Three screenshots on the public docs site still show the `PRO` tier badge
rendered into the image pixels. F693–F695 removed Pro from the product, the
code, and all docs *prose*, but image content is invisible to grep, so the
purge missed them. Anyone reading `/docs/guides/insights` today sees a tier
badge for a product tier that no longer exists.

The images also show the retired `gg` (Gemini CLI) agent in the quota strip,
so they are doubly stale.

The fix is a re-capture against the current OSS dashboard, not a rename —
renaming `insights-pro.png` to `insights.png` would relabel the file while
leaving the misleading pixels in place.

## User Stories
- [ ] As a prospective user reading the Insights guide, I see screenshots that match the product I can actually install, with no reference to a paid tier.
- [ ] As a maintainer, I can be confident the docs site carries no Pro branding in any medium, prose or image.

## Acceptance Criteria
- [ ] `site/public/img/summary-pro.png` re-captured with no `PRO` badge, renamed to `summary.png`.
- [ ] `site/public/img/charts-pro.png` re-captured with no `PRO` badges (it currently carries four), renamed to `charts.png`.
- [ ] `site/public/img/insights-pro.png` re-captured with no `PRO` badge, renamed to `insights.png`.
- [ ] All four references updated: `content/guides/insights.mdx` (lines 18, 27, 47) and `site/public/home.html` (line 657).
- [ ] No re-captured screenshot shows the retired `gg` agent in the quota strip.
- [ ] `npm run docs:check` passes (it validates image links).
- [ ] No file under `site/public/img/` has `-pro` in its name.

## Validation
```bash
npm run docs:check
test -z "$(ls site/public/img | grep -- -pro)"
```

## Technical Approach

Use the `refresh-docs-screenshots` skill, which walks each referenced image
and offers skip / replace-with-CleanShot / delete. Capture from a dashboard
showing real data — the Insights view needs populated analytics to look
meaningful, so capture from the primary dashboard rather than a seeded
fixture repo.

Screenshots must be saved to `./tmp/` during capture per the repo rule, then
moved into `site/public/img/`.

## Dependencies
- Prior work F694 removed Pro from docs prose and retired the `/pro` page.

## Out of Scope
- Any other docs screenshot not listed above.
- Re-capturing screenshots to reflect UI changes unrelated to the Pro purge.

## Open Questions
- Should the quota strip be cropped out entirely to make these images more durable against agent-roster churn?

## Related
- Prior work: F693 (merge Pro into OSS), F694 (purge Pro from docs), F695 (remove Pro wizard step)
