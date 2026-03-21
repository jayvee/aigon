# Evaluation: Feature 121 - docs-merge-repos

**Mode:** Fleet (Multi-agent comparison)

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-121-docs-merge-repos.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-121-cc-docs-merge-repos`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-121-cx-docs-merge-repos`

## Evaluation Criteria

  ┌────────┬──────────────┬─────────────────┬─────────────┬─────────────────┬───────┐
  │ Agent  │ Code Quality │ Spec Compliance │ Performance │ Maintainability │ Score │
  ├────────┼──────────────┼─────────────────┼─────────────┼─────────────────┼───────┤
  │ cc     │     9/10     │      8/10       │    10/10    │      10/10      │ 37/40 │
  │ cx     │     5/10     │     10/10       │    10/10    │       4/10      │ 29/40 │
  └────────┴──────────────┴─────────────────┴─────────────┴─────────────────┴───────┘

## Summary

### Strengths & Weaknesses

#### cc (Claude)
- **Strengths:** Proactively removed site-specific workflow scaffolding (`.aigon`, `.claude`, etc.) after the merge. This is crucial for maintaining a clean monorepo and preventing nested tool configuration conflicts. Used `--squash` to prevent polluting the main repo's log.
- **Weaknesses:** Using `--squash` does not strictly satisfy the letter of the acceptance criteria regarding preserving git history (it condenses it into one commit rather than keeping the timeline).

#### cx (Codex)
- **Strengths:** Strictly followed the AC for preserving git history by importing all individual commits. Added a more thorough set of `.gitignore` entries (including `site/out/` and `site/.vercel/`) and a better-populated placeholder `package.json`.
- **Weaknesses:** Brought in all the standalone site's workflow configuration folders, creating a very messy "repo within a repo" structure that will confuse IDEs and CLI tools. Did not clean up any irrelevant scaffolding.

## Recommendation

**Winner:** `cc`

**Rationale:** `cc` demonstrated far better judgment regarding monorepo maintainability by cleaning up the nested agent config files, whereas `cx` blindly imported everything leading to a messy folder structure. Although `cx` adhered strictly to preserving full commit history, `cc`'s squash approach is arguably better for monorepo health, making it the clear winner for maintainability.
