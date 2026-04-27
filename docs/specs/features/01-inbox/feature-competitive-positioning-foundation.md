---
complexity: very-high
set: competitive-positioning
---

# Feature: competitive-positioning-foundation

## Summary
Build the internal competitive matrix, the public comparison page, and the canonical positioning copy in one coordinated PR. Source of truth becomes `docs/competitive/`; the public surface (`site/content/comparisons.mdx`) is rewritten around 5 philosophy axes with observable cell values; positioning copy lands in `docs/marketing/positioning.md` and propagates to README, AGENTS.md, llms.txt, landing hero, and repo description. Closes F238 and deletes `docs/comparisons-extended.md`. Category claim is **"spec-driven multi-agent harness"**.

## User Stories
- [ ] As a prospective user landing on the public comparison page, I see how Aigon approaches multi-agent coding vs ~10 named tools across 5 observable axes, with honest trade-offs — not feature-checkmark dots.
- [ ] As a contributor, I open `docs/competitive/` and find one source of truth: the 4-tier landscape, the 10-axis matrix, per-tool deep-dives, and an honest-weaknesses section.
- [ ] As a marketer or maintainer, I copy a chunk from `docs/marketing/positioning.md` and use it verbatim — every other surface (README, AGENTS.md, llms.txt, repo description, landing hero) already aligns to the same chunks.

## Acceptance Criteria
- [ ] `docs/competitive/` exists with: `landscape.md` (4 tiers; GSD given tier-1 prominence alongside Cline Kanban, Google Scion, Cursor 3 Agents Window, Spec Kit), `matrix.md` (10 axes × all tracked tools), per-tool deep-dives in `entries/`, `weaknesses.md` (per-competitor wins + Aigon's own honest weaknesses).
- [ ] `docs/marketing/positioning.md` exists with one-liner, one-paragraph, one-page versions, plus 7 reusable copy chunks (`hero`, `bio`, `readme`, `conference`, `llms`, `agents`, `elevator`). Category claim verbatim: "spec-driven multi-agent harness".
- [ ] `site/content/comparisons.mdx` is rewritten around 5 public axes (unit of work, multi-agent posture, model flexibility, evaluation/QA, pricing) × ~10 tools, with observable cell values. GSD is a tier-1 row.
- [ ] `project_standard_descriptor.md`, `AGENTS.md` opener, `README.md` opener, `site/llms.txt`, GitHub repo description, and the site landing hero all use chunks from `positioning.md` verbatim — no drift, single source.
- [ ] F238 is closed in the same PR with a commit citing this feature; `docs/comparisons-extended.md` is deleted.
- [ ] OpenCode lineage is verified before any cell is written (cc says `anomalyco/opencode` is the active TS fork; op says Charm's Crush is the Go-lineage successor — both can be real and distinct, but the matrix must reflect ground truth, not either finding alone).

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- `docs/competitive/matrix.md` is the source of truth. The public page and the positioning chunks are projections of it; never edit a projection without updating the source.
- Seed from R44 findings: cc's 11-row public matrix and 10-axis taxonomy (§3, §5 of `docs/specs/research-topics/logs/research-44-cc-findings.md`); op's three-category mental model (coding agents / agentic IDEs / workflow orchestrators) and 7 reusable copy chunks (§1, §3, §5 of `research-44-op-findings.md`).
- Reconcile OpenCode disagreement up front via direct repo check (anomalyco TS fork vs Crush Go fork — likely both are real, separate tools; the matrix needs both rows or one with a clear lineage note).
- Use cc's harness-era axis vocabulary on the internal matrix (orchestration substrate, multi-agent posture, autonomy level) and op's safer market vocabulary where it improves legibility on the public page (agent strategy, state ownership, quality assurance).

## Dependencies
- depends_on: none

## Out of Scope
- The monthly recurring competitive scan (separate feature in this set).
- First-class local-model support (separate feature in this set; surfaces as a gap in `weaknesses.md` but is not closed here).
- Marketing channel strategy, ad copy, SEO.
- Site-wide design changes beyond the `comparisons.mdx` rewrite.

## Related
- Research: R44 — competitive positioning and landscape
- Set: competitive-positioning
- Supersedes: F238 (merge-comparisons-extended-into-public-site)
