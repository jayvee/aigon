# Feature: merge comparisons-extended into public site

## Summary
The public-facing comparisons page at `site/content/comparisons.mdx` is a trimmed subset of the full comparisons content. The fuller version lives at `docs/comparisons-extended.md` (moved from the repo root on 2026-04-07 during the launch cleanup). The extended version contains material that would make the public page noticeably stronger but hasn't been ported across yet. This feature does that port and then deletes `docs/comparisons-extended.md` so there's a single source of truth.

## What's missing from the public version

| Missing item | Type |
|---|---|
| **GitHub Copilot Workspace** | Whole tool comparison entry |
| **Tessl** | Whole tool comparison entry |
| **LangGraph** | Whole tool comparison entry |
| **BMad Method** | Whole tool comparison entry |
| Detailed "Aigon's Standout Features" section with 4 named items + per-item descriptions | Content depth |
| Detailed "Aigon Gaps" subsections (IDE Integration, Visual UI, Community Size, Setup Friction) | Content depth |
| Sources / citations section with links to all tools | Content depth |

The public version has been deliberately tightened for readability. The merge should keep that tightened style while adding the missing tools and the sources section — not just paste the long version back in.

## Acceptance Criteria

- [ ] **AC1** — `site/content/comparisons.mdx` includes a comparison entry for each of: GitHub Copilot Workspace, Tessl, LangGraph, BMad Method. Each entry follows the same format as the existing entries.
- [ ] **AC2** — `site/content/comparisons.mdx` has a "Sources" section near the bottom with links to each tool's homepage and any cited research/blog posts.
- [ ] **AC3** — The "Where Aigon falls short" section is expanded to mention IDE Integration, Visual UI, Community Size, and Setup Friction (1–2 sentences each, not the full essay form from the extended version).
- [ ] **AC4** — The new public page is no more than ~50% longer than the current trimmed version. Goal: enrich, don't bloat.
- [ ] **AC5** — `docs/comparisons-extended.md` is deleted in the same commit as the merge.
- [ ] **AC6** — `npm run --prefix site build` succeeds (catches MDX syntax issues).
- [ ] **AC7** — Manual visual check: render the page locally and confirm the new entries display correctly.

## Validation
```bash
cd site && npm run build && cd ..
! grep -q "comparisons-extended" site/content/comparisons.mdx
```

## Technical Approach

1. **Read both files side by side.** The trimmed style of the public version is the target tone. Don't paste sections wholesale.
2. **Add the 4 missing tool entries** following the existing entry pattern (one-paragraph description + bullets for strengths/weaknesses + relation to Aigon). Source material is in `docs/comparisons-extended.md` under each tool's section.
3. **Expand "Where Aigon falls short"** to 4–5 short bullets covering IDE Integration, Visual UI, Community Size, Setup Friction. 1 sentence each, scannable.
4. **Add Sources section** as a `<details>` collapsible block to keep visual weight low. Link each tool homepage + any research/industry reports cited.
5. **Delete `docs/comparisons-extended.md`** in the same commit. Single source of truth from then on.
6. **Update any references** — grep for `comparisons-extended` first.

## Dependencies
- None — pure docs work

## Out of Scope
- Re-researching any of the tools — use what's already in the extended version
- Adding tools that aren't in either version
- Restructuring the public comparisons page layout (hero image, TOC, etc.)
- Updating the master feature matrix table

## Open Questions
- Should the Sources section be a `<details>` collapsible (recommended) or a plain section?
- Should the BMad Method entry note that it's a methodology, not a tool? Recommend yes — call it out as "methodology rather than tooling".

## Related
- `docs/comparisons-extended.md` — the source for this merge
- `site/content/comparisons.mdx` — the destination
- 2026-04-07 launch cleanup commit — moved COMPARISONS.md from repo root to docs/
- `research-21-coding-agent-landscape.md` — different angle, not a duplicate
