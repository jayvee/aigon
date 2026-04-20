# Implementation Log: Feature 287 - token-reduction-1-slim-always-on-context
Agent: cc

## Summary
- **CLAUDE.md**: 286 → 20 lines. Moved load-bearing sections (State Architecture, Testing Discipline, Frontend Rules, missing Rules #3/#7/#8, extra Common Agent Mistakes) into AGENTS.md so it is the single source of truth; CLAUDE.md is a thin pointer.
- **Hot templates (source)**: 634 → 312 lines (−322). Collapsed the 42-line "Worktree execution rules (MANDATORY)" block and the 25-line "Step 0: Verify your workspace" ceremony in `feature-do.md` into a single invariant sentence; stripped duplicate `aigon feature-spec` lookup from `feature-eval.md` / `feature-review.md` (spec is inlined by the launcher); tightened Signal-completion and Fleet-eval templates.
- **Installed working copies (per agent)**:
  - cc (`.claude/commands/aigon/feature-*.md`): 697 → 364 lines (−333)
  - gg (`.gemini/commands/aigon/feature-*.toml`): 697 → 364 lines (−333)
  - cx (`.agents/skills/aigon-feature-*/SKILL.md`): 700 → 368 lines (−332)
- **Placeholder resolvers**: `WORKTREE_DEP_CHECK` now embeds its `## Before Step 3: ...` heading so ios/android/generic profiles return `""` and the whole block disappears. `SETUP_ENV_LOCAL_LINE` prepends its own newline so empty variants don't leave dangling whitespace. `DOCUMENTATION_SECTION` was shortened and now points at AGENTS.md (not CLAUDE.md).
- **Template post-processing**: `processTemplate()` now collapses `\n{3,}` → `\n\n` so empty placeholders never leave 3+ blank lines.
- **MEMORY.md**: pruned retired-agent (mv) and superseded entries (cu-retired note, features 229/231 split, /next skill fix on feature-247, Fumadocs theming). Deleted the 5 topic files. Corrected the stale "aigon-cli.js is ~2800+ lines" claim (now ~90 lines post-modularisation).

## Pre/post prompt-size delta (representative `feature-do` launch)
| Surface | Pre | Post | Δ |
|---|---:|---:|---:|
| CLAUDE.md | 286 | 20 | −266 |
| AGENTS.md | 209 | 224 | +15 |
| cc hot templates (4) | 697 | 364 | −333 |
| gg hot templates (4) | 697 | 364 | −333 |
| cx hot skills (4) | 700 | 368 | −332 |

Net: the always-on context load (CLAUDE.md + `feature-do` working copy) dropped by roughly **−550 lines per agent** on a cold launch.

## Decisions
- AGENTS.md now holds everything; CLAUDE.md is a 20-line pointer that lists only the hottest rules. The Claude Code harness still auto-loads CLAUDE.md, so a minimal pointer keeps the baseline small while the agent fetches AGENTS.md on demand.
- Left `feature-start.md` template's `SETUP_ENV_LOCAL_LINE` placeholder at end-of-line; now the resolver prepends its own newline so empty variants collapse cleanly.
- Did not touch `feature-do.md`'s DEP check heading in the template itself — moved it into the resolver so "not applicable" profiles (ios/android/generic) get zero lines instead of a dangling `## Before Step 3` heading with no body.
