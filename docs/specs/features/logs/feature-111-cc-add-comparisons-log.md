# Implementation Log: Feature 111 - add-comparisons
Agent: cc

## Plan

Replace the Cursor-only COMPARISONS.md with a comprehensive comparison of 13 tools (including Aigon) across 12 dimensions. Research each tool via web fetch, write honest assessments, and structure as: matrix → profiles → standouts → weaknesses → complementary usage.

## Progress

- Researched all 13 tools via web fetches (Kiro, AmpCode, Augment, Tessl, Cline, LangGraph, GSD, BMad, OpenSpec, Aider, OpenCode, Copilot Workspace — Cursor already documented)
- Wrote master feature matrix with 12 dimensions and clear ●/◐/○ symbols
- Created brief profiles (2-4 sentences each) with philosophy, pricing, and "when to choose" guidance
- Documented 4 honest weaknesses (IDE integration, visual UI, community size, setup friction)
- Documented 4 unique standout features (Fleet mode, spec lifecycle, research workflows, feedback triage)
- Removed "Coming Soon" and "Strategic Gaps" sections
- Kept and expanded "Complementary Usage" with 5 tool combinations
- Validated all 10 acceptance criteria pass

## Decisions

- **Matrix symbols**: Used ● (full), ◐ (partial), ○ (none) instead of checkmarks — clearer at a glance in monospace
- **Tool categorisation**: Split into Commercial (6) and Open Source (7) sections, with Aigon featured in the matrix but not given its own profile (it's the reference point)
- **LangGraph inclusion**: Noted it's an agent framework, not a coding assistant — included because it's in the spec, but clarified the category difference
- **Copilot Workspace**: Noted the technical preview ended May 2025 — still included as its spec-driven ideas influenced the landscape
- **Tessl**: Positioned as complementary (skills platform) rather than competitive — it makes agents smarter, not a workflow tool
- **Honesty**: Aigon gets ○ on IDE integration and community size, ◐ on visual UI — these are genuine gaps, not spin
