# Evaluation: Feature 110 - rationalise-readme-guide

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-110-rationalise-readme-guide.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-110-cc-rationalise-readme-guide`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-110-cx-rationalise-readme-guide`
- [x] **gg** (Gemini): `/Users/jviner/src/aigon-worktrees/feature-110-gg-rationalise-readme-guide`

## Evaluation Criteria

| Criteria | cc | cx | gg |
|---|---|---|---|
| Code Quality | 9/10 | 5/10 | 7/10 |
| Spec Compliance | 9/10 | 7/10 | 6/10 |
| Performance | 8/10 | 4/10 | 7/10 |
| Maintainability | 9/10 | 6/10 | 7/10 |
| **Total** | **35/40** | **22/40** | **27/40** |

| Agent | Lines | Score |
|---|---|---|
| cc | -172 net | 35/40 |
| cx | -1744 net | 22/40 |
| gg | -242 net | 27/40 |

## Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Best balance of reduction vs preservation — trimmed ~8% while fixing every identified mismatch
  - All 9 acceptance criteria addressed: feature-eval marked Fleet-only, init/install-agent separated, dashboard subcommands removed, agent status corrected to `.aigon/state/`, feedback-promote replaced, Codex --full-auto fixed, duplication consolidated
  - Added a comprehensive CLI Reference section with missing commands (research-submit, research-autopilot, feature-submit, feature-validate, feature-autopilot, sessions-close, conductor, deploy, dev-server open, proxy subcommands)
  - "Big Picture" section surgically trimmed to focused "Traceability" section — kept the useful forward/backward traceability content, removed the repetitive lifecycle philosophy
  - GUIDE install-agent detail replaced with link to README, reducing duplication while keeping one canonical source
- Weaknesses:
  - README still keeps the full per-agent install-agent table (could be slightly more compact)
  - Could have been slightly more aggressive trimming the Dashboard section

#### cx (Codex)
- Strengths:
  - Correctly identified all stale references and explicitly called out removed dashboard subcommands
  - Cleanly separated `aigon init` from `install-agent`
  - Noted feedback-promote as non-current
  - Added a validation checklist section for future doc maintainers
- Weaknesses:
  - **84% content reduction is far too aggressive** — README went from 626 to 119 lines, GUIDE from 1432 to 208 lines
  - Lost essential user-facing content: hooks deep dive, project profiles, proxy configuration details, configuration reference, evaluation examples, contributing guide, opening worktrees section
  - The GUIDE is now barely a command reference — doesn't fulfill the spec's requirement that "GUIDE becomes the detailed workflow/reference document"
  - README lost dashboard screenshots, "Getting Started" detail, supported agents table, context delivery explanation
  - Users would need to read source code for information that should be in docs

#### gg (Gemini)
- Strengths:
  - Conservative, safe approach — 12% reduction preserves most useful content
  - Added helpful note clarifying feature-eval is Fleet-only in Drive section
  - Correctly removed dashboard install/uninstall/vscode-install/menubar-install
  - Fixed Codex --full-auto and feedback-promote references
  - Changed dashboard autostart to match current `autostart` subcommand
- Weaknesses:
  - **Still references "front matter" for agent status** in GUIDE lines 93 and 125 — directly violates AC: "docs no longer describe agent status as living in implementation-log front matter"
  - README line 367: feature-eval still listed in generic feature lifecycle without Fleet qualifier — violates AC about not presenting feature-eval as a normal Drive step
  - Didn't update the CLI reference tables with missing commands
  - Still has the full install-agent table duplicated in GUIDE (not consolidated)
  - Changed dashboard port to 4100/4080 which may introduce new inaccuracies

## Recommendation

**Winner:** cc (Claude)

**Rationale:** cc delivered the best balance — targeted 8% reduction that fixes all identified mismatches while preserving the detailed reference content users need. The added CLI Reference section and surgical "Big Picture" → "Traceability" consolidation show good editorial judgment. cx over-corrected by removing 84% of content, gutting essential reference material. gg was too conservative and missed key acceptance criteria (front matter references, feature-eval in Drive lifecycle).

**Cross-pollination:** Before merging, consider adopting from gg: the explicit "Note: `feature-eval` (automated comparison) is only available in Fleet mode" callout box added after the Drive section (GUIDE line 109) is a nice UX touch that cc's implementation handles less prominently. Also consider adopting from cx: the explicit listing of removed dashboard subcommands in a "not implemented" callout — useful as a migration note for existing users.
