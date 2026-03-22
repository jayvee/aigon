# Evaluation: Feature 128 - docs-content

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-128-docs-content.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-128-cc-docs-content`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-128-cx-docs-content`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 9/10 | 7/10 |
| Spec Compliance | 9/10 | 5/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 9/10 | 7/10 |
| **Total** | **35/40** | **27/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 2659 | 35/40 |
| cx | 1709 | 27/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **Deep, actionable content**: Every page has real commands, flags, tables, and worked examples — the getting-started page alone covers installation, agents table, interaction modes, and the full step-by-step loop
  - **Comprehensive coverage**: 6 guide pages (Drive, Fleet, Autopilot, Research, Dashboard, Feedback), 3 filled concepts pages, full configuration reference with hooks, models, profiles, and port config
  - **Comparisons page fully ported**: Feature matrix, per-tool "choose X when / choose Aigon when" breakdowns, complementary usage section — the entire COMPARISONS.md is represented
  - **Mermaid diagrams**: Lifecycle diagrams are inline Mermaid in specs-and-state.mdx, rendered natively by Fumadocs — no static assets to maintain
  - **gen-commands.js**: Groups commands by domain, generates an index page with linked tables, handles MDX angle-bracket escaping, produces slash command usage examples
  - **Configuration reference**: 198 lines covering config commands, global/project JSON examples, options table, profiles, port config, model selection, CLI flag overrides, and hooks — essentially a standalone reference
- Weaknesses:
  - Dashboard guide omits screenshots (noted in log as intentional deferral — images do exist in the repo)
  - Some generated command pages have redundant "Arguments" section that repeats the synopsis

#### cx (Codex)
- Strengths:
  - **SVG lifecycle diagrams**: Hand-crafted SVGs for feature and research lifecycles — clean, accessible, and framework-independent
  - **More granular concepts section**: Split into 7 separate pages (agent-architecture, spec-driven-development, state-machine, worktrees, evaluation, execution-modes, specs-and-state) vs CC's 3
  - **gen-commands.js extracts flags**: Parses `--flag` patterns from argHints and lists them separately, and extracts examples from template bash blocks
  - **Dashboard guide references existing screenshots/GIFs**: Uses `![Kanban monitor](/img/aigon-dashboard-kanban.png)` and fleet animation GIFs
  - Both builds pass cleanly
- Weaknesses:
  - **Extremely thin content on most pages**: specs-and-state is 13 lines vs CC's 97; configuration is 19 lines vs CC's 198; comparisons is 26 lines ("see source document at the repo root"); agents reference is 14 lines; worktrees is 15 lines
  - **Empty implementation log**: The log has no plan, progress, or decisions — suggesting minimal engagement with the task
  - **Comparisons page is a stub**: Punts to the repo root file instead of porting the content, directly violating the spec
  - **No feedback workflow guide**: Spec required guides for feature lifecycle, research lifecycle, and dashboard — CX created feature-lifecycle and research-lifecycle but they are very brief
  - **Getting-started page lacks depth**: No agents table, no interaction modes, no "what's next" links — just a bare CLI snippet
  - **Several concept pages are 3-4 sentence stubs** that don't teach anything actionable (e.g., agent-architecture: 4 bullet points)

## Recommendation

**Winner:** cc (Claude)

**Rationale:** CC's implementation is substantially more complete. It fills every page with real, actionable content — commands, flags, examples, tables, and cross-references. CX created a broader page structure (more individual concept files, SVG diagrams) but almost every page is a thin stub that doesn't meet the spec's requirement for actual migrated content from README, GUIDE, and architecture docs. The spec called for "structured MDX pages" with content from existing docs — CC delivered that; CX created placeholders.

**Cross-pollination:** Before merging, consider adopting from cx: the SVG lifecycle diagrams (`site/public/img/aigon-feature-lifecycle.svg` and `aigon-research-lifecycle.svg`) are well-crafted and complement CC's Mermaid diagrams. Also consider CX's approach of splitting concepts into more granular pages (agent-architecture, worktrees, state-machine as separate files) — though they'd need CC-quality content to be useful. CX's gen-commands flag extraction logic (`getFlags()` parsing `--flag` patterns from argHints) is a nice touch that CC's version lacks.
