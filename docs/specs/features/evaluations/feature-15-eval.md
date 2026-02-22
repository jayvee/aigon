# Evaluation: Feature 15 - agent-file-standards

**Mode:** Arena (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-15-agent-file-standards.md`

## Implementations to Compare

- [x] **cc** (Claude): 2 commits, 6 files, +69/-18
- [x] **cx** (Codex): 2 commits, 12 files, +154/-53
- [x] **gg** (Gemini): 1 commit, 8 files, +88/-7

## Evaluation Criteria

| Criteria | cc | cx | gg |
|----------|---|---|---|
| Code Quality | 8/10 | 9/10 | 7/10 |
| Spec Compliance | 9/10 | 10/10 | 7/10 |
| Completeness | 8/10 | 9/10 | 6/10 |
| Maintainability | 8/10 | 9/10 | 8/10 |

## Acceptance Criteria

All 7 ACs met by cc and cx. gg meets ACs 1-4 and 6-7 but has a critical bug in AC5 (agent detection breaks for Gemini/Codex after this change).

| AC | cc | cx | gg |
|----|----|----|-----|
| 1. AGENTS.md created with scaffold + markers | ✅ | ✅ | ✅ |
| 2. GEMINI.md no longer generated | ✅ | ✅ | ✅ |
| 3. .codex/prompt.md no longer generated | ✅ | ✅ | ✅ |
| 4. CLAUDE.md with pointer to AGENTS.md | ✅ | ✅ | ✅ |
| 5. `aigon update` migration notices | ✅ | ✅ | ⚠️ Bug |
| 6. Agent commands unchanged | ✅ | ✅ | ✅ |
| 7. Agent doc references AGENTS.md | ✅ | ✅ | ✅ |

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - All 7 ACs met, clean focused diff (+69/-18)
  - Rewrote agent detection with per-agent artifact checks (`.gemini/commands/aigon/`, `.codex/config.toml`, `.cursor/commands/`)
  - Targeted detection approach — more efficient than checking all artifact types
- Weaknesses:
  - Missing `supportsAgentsMd` flag in agent configs (spec recommended it)
  - Missing .gitignore, README.md, GUIDE.md, feature-implement.md updates

#### cx (Codex)
- Strengths:
  - All 7 ACs met, most comprehensive implementation
  - Multi-artifact agent detection (docs, commands, settings, config) — most future-proof
  - Updated .gitignore, README.md, docs/GUIDE.md, feature-implement.md template
  - Defensive marker extraction fallback in syncAgentsMdFile()
  - Comprehensive implementation log with testing notes
- Weaknesses:
  - `supportsAgentsMd` flag added but unused (metadata only)
  - Larger diff due to detection rewrite and doc updates (but both are valuable)

#### gg (Gemini)
- Strengths:
  - Core feature works: AGENTS.md created, legacy files stopped, CLAUDE.md pointer added
  - Clean data-driven migration notice approach
  - Smallest core diff (+43/-4 in aigon-cli.js)
- Weaknesses:
  - **Critical bug**: did NOT rewrite agent detection in `update` — still checks `config.rootFile` which is now `null` for Gemini, so `aigon update` will fail to detect existing Gemini installations
  - Missing .gitignore update
  - Missing README.md, GUIDE.md updates

## Recommendation

**Winner:** cx (Codex)

**Rationale:**

All three implementations nail the core feature (AGENTS.md generation, legacy file suppression, CLAUDE.md pointer). The differentiator is completeness:

1. **Agent detection** — Both cc and cx correctly rewrote detection to handle agents without root files. gg did not, which is a critical bug. cx's multi-artifact approach is the most robust and future-proof.

2. **Peripheral updates** — cx is the only one that updated .gitignore, README, GUIDE, and the feature-implement template. These matter for discoverability and preventing users from accidentally committing generated files.

3. **Defensive coding** — cx's marker extraction fallback handles edge cases that cc and gg don't.

cc is a strong runner-up — solid core implementation with correct agent detection, just missing the peripheral polish. gg has the critical detection bug that would need fixing before merge.
