# Evaluation: Feature 25 - context-aware-next

**Mode:** Arena (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-25-context-aware-next.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-25-cc-context-aware-next`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-25-cx-context-aware-next`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 9/10 | 7/10 |
| Spec Compliance | 9/10 | 7/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 9/10 | 6/10 |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Comprehensive, well-structured `next.md` template (156 lines) with clear decision tree paths (A–E)
  - Each path has explicit conditions, user-facing explanations, and ready-to-copy commands
  - Correct alias convention: `an` matches the `a`-prefix pattern (not bare `n`)
  - Full CLI integration: added `next` handler, `COMMAND_ARG_HINTS`, help text with new "Context-Aware" section
  - Path D (main branch) correctly distinguishes arena vs solo and suggests eval vs done accordingly
  - Graceful fallback (Path E) when context is ambiguous — shows board instead of guessing
  - Did NOT create a duplicate `n.md` template file — relies on `COMMAND_ALIASES` for the short form
- Weaknesses:
  - References `aigon feature-implement --info <ID>` in spec analysis but correctly noted it doesn't exist and worked around it — not a weakness per se, but the spec's dependency was identified and handled
  - No README or `agent.md` updates (minor — cx did this extra work)

#### cx (Codex)
- Strengths:
  - Updated README command tables across all 4 agent sections — good docs coverage
  - Updated `templates/generic/docs/agent.md` with the new command
  - Concise template (84 lines) — more compact decision tree
  - Conservative fallback approach matches spec intent
- Weaknesses:
  - Created a separate `n.md` (82 lines) that duplicates the entire `next.md` content — this is a maintenance burden and goes against the alias pattern used everywhere else in Aigon
  - Added both `"next"` and `"n"` to all 4 agent JSON configs, meaning `install-agent` will copy two near-identical template files instead of using the alias system
  - CLI changes are minimal: only added the alias to `COMMAND_ALIASES`, no `next` command handler, no `COMMAND_ARG_HINTS` entry, no help text section in CLI output
  - Research branch logic maps "non-empty git status" → `research-done`, which is wrong — uncommitted changes in a research branch more likely mean you're mid-research, not done
  - References `aigon feature-implement --info <ID>` which doesn't exist, and unlike cc, didn't note or work around this
  - Help template reformatting shuffles existing alias rows unnecessarily

## Recommendation

**Winner:** cc (Claude)

**Rationale:** cc's implementation is significantly more complete and thoughtful. The template is well-structured with clear labeled paths, proper user-facing explanations for each suggestion, and correct arena/solo detection on the main branch. The CLI integration is thorough — handler, arg hints, help section all included. Most importantly, cc correctly used `COMMAND_ALIASES` for the short form (`an` → `next`) instead of duplicating the entire template into a separate `n.md` file, which is how every other alias in Aigon works. cx's duplicate template approach would create a maintenance burden and is inconsistent with the project's conventions.

**Cross-pollination:** cx's README and `agent.md` updates are worth adopting — cc didn't update these docs. The specific additions (one line per agent table in README, one line in agent.md utility commands) are straightforward to cherry-pick.

