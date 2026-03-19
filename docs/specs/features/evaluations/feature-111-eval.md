# Evaluation: Feature 111 - add-comparisons

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-111-add-comparisons.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-111-cc-add-comparisons`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-111-cx-add-comparisons`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-111-gg-add-comparisons`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|---|---|---|---|
| Code Quality | 9/10 | 8/10 | 9/10 |
| Spec Compliance | 10/10 | 10/10 | 10/10 |
| Performance | 9/10 | 8/10 | 8/10 |
| Maintainability | 9/10 | 9/10 | 9/10 |
| **Total** | **37/40** | **35/40** | **36/40** |

| Agent | Lines | Score |
|---|---|---|
| cc | +332/−270 | 37/40 |
| cx | +225/−275 | 35/40 |
| gg | +191/−288 | 36/40 |

## Summary

All three implementations successfully meet every acceptance criterion (10/10). The differences are in execution quality, writing depth, and structural polish.

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Most comprehensive rewrite (377 lines final, 332 insertions)
  - Excellent symbol system (● ◐ ○) — highly readable in monospace/terminal
  - 21 sources cited with URLs for fact-checking
  - Strongest "Complementary Usage" section (5 tool combinations with clear value props)
  - Best persona-based "When to Choose" framing (addresses the reader's situation, not just listing features)
  - Standout features section with concrete bash examples
- Weaknesses:
  - Longest document — slightly more than needed for the task scope
  - No README.md updates (minor; spec didn't require it)

#### cx (Codex)
- Strengths:
  - Clean, professional structure with consistent tool profile template
  - All 13 tools × 11 dimensions — meets spec precisely
  - Good pricing accuracy and transparent cost model coverage
  - 15 sources cited
- Weaknesses:
  - Matrix has 13 columns — can cause horizontal scroll issues
  - Profile depth varies slightly between tools (some 2 sentences, some 4)
  - Writing is competent but less distinctive than cc's persona-based framing

#### gg (Gemini)
- Strengths:
  - Most efficient rewrite — achieves full coverage in fewest lines (218 lines, +191 insertions)
  - 14 tools × 12 dimensions — exceeds spec on both counts
  - Updated README.md with better COMPARISONS.md context pointers
  - Strong "Key Takeaway" section with actionable decision framework
  - Best positioning statement: "Aigon fills the gap between 'vibe coding' and 'enterprise engineering'"
- Weaknesses:
  - Uses emoji symbols (✅ ⚠️ ❌) — less clean than cc's Unicode circles in markdown rendering
  - Complementary Usage section is brief (3 examples vs cc's 5)
  - Some OSS tool profiles could be deeper

## Recommendation

**Winner:** cc (Claude)

**Rationale:** All three are production-ready and spec-compliant. cc wins on writing quality: the persona-based "When to Choose" framing is more useful to readers than feature lists, the ● ◐ ○ symbol system renders better across terminals and markdown viewers, and the 5-combination Complementary Usage section best serves the spec's goal of showing Aigon alongside other tools. The 21 cited sources also make future maintenance easier.

**Cross-pollination:** Before merging cc, consider adopting from gg: (1) the README.md updates that add better context pointers to COMPARISONS.md, and (2) the "Key Takeaway" decision framework paragraph ("Aigon fills the gap between 'vibe coding' and 'enterprise engineering'") which is a strong positioning statement not present in cc's version.
