# Evaluation: Feature 112 - promotional-gif-demos-for-aigon-dashboard-and-cli

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-112-promotional-gif-demos-for-aigon-dashboard-and-cli.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-112-cc-promotional-gif-demos-for-aigon-dashboard-and-cli`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-112-cx-promotional-gif-demos-for-aigon-dashboard-and-cli`

## Evaluation Criteria

| Criteria | cc | cx |
|---|---|---|
| Code Quality | 8/10 | 8/10 |
| Spec Compliance | 5/10 | 9/10 |
| Performance | 7/10 | 8/10 |
| Maintainability | 8/10 | 9/10 |
| **Total** | **28/40** | **34/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | 148 | 28/40 |
| cx | 243 | 34/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - Clean, well-commented optimize-gifs.sh with both batch and single-file modes
  - Excellent RECORDING.md with scenario table — great quick-reference for the human doing recordings
  - Conservative approach: sets up infrastructure and leaves recording to the user (which is honest — these are screen recordings)
- Weaknesses:
  - **No actual GIFs produced** — the gifs/ directory has only a .gitkeep. The spec says "5 GIFs recorded and optimised, stored in docs/media/gifs/" — this is not met
  - No validation script — no way to verify GIFs meet the 800px/15fps/3MB constraints
  - No generation script — purely manual workflow with no automation beyond optimisation

#### cx (Codex)
- Strengths:
  - **All 5 GIFs actually exist** and are all under 3MB (2.1–2.9MB each)
  - Full pipeline: generate → optimize → validate, all scripted
  - Adaptive optimization loop in optimize-gifs.sh — automatically increases lossy/reduces colors until under 3MB
  - Validation script checks size, width, and fps timing — matches the spec's validation criteria
  - Clever reuse of existing dashboard GIFs and screenshots as source material via ffmpeg
- Weaknesses:
  - GIFs are derived from existing assets (cropped/zoomed stills and short clips), not actual screen recordings of the real workflows — they're placeholders, not the final promotional GIFs
  - Requires ffmpeg + ImageMagick as additional dependencies beyond gifsicle
  - The zoompan effect on GIF 4 (static image with slow zoom) is not a convincing "research autopilot" demo

## Recommendation

**Winner:** cx (Codex)

**Rationale:** cx delivered significantly more of the spec — actual GIF files, a complete generate→optimize→validate pipeline, and adaptive optimization. cc only delivered the infrastructure (optimize script + recording guide) but zero GIFs. While neither implementation has "real" screen recordings (those require a human with CleanShot X), cx provides working placeholder GIFs and a repeatable pipeline to replace them, whereas cc provides an empty directory.

**Cross-pollination:** Before merging, consider adopting from cc: the `RECORDING.md` guide. It's a better quick-reference for the human recording session than cx's README.md — it has the scenario table with durations and the step-by-step CleanShot X workflow. Worth copying it into cx's tree alongside the README.

