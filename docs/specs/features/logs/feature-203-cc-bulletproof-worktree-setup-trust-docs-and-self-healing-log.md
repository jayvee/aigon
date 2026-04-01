# Implementation Log: Feature 203 - bulletproof-worktree-setup-trust-docs-and-self-healing
Agent: cc

## Plan

Implement all acceptance criteria from the spec:
1. Move worktrees to ~/.aigon/worktrees/{repoName}/
2. Backward compatibility with legacy sibling location
3. aigon init creates worktree dir and trusts it
4. Self-healing trust in buildAgentCommand shell wrapper
5. Config auto-restore on corrupt loadGlobalConfig
6. aigon doctor worktree checks and pruning
7. aigon config restore subcommand
8. aigon trust-worktree command

## Progress

- All 10 files modified, 297 insertions, 27 deletions
- All syntax checks pass
- Spec validation passes (getWorktreeBase returns ~/.aigon/worktrees path)

## Decisions

- **Backward compat strategy**: Both new (~/.aigon/worktrees/{repo}/) and legacy (../{repo}-worktrees/) locations are checked. New worktrees are always created in the new location. Legacy worktrees continue to work.
- **resolveFeatureWorktreePath**: Tries new location first, falls back to legacy by detecting the .aigon/worktrees path pattern and deriving possible legacy locations.
- **resolveTmuxRepoName**: Updated to detect both path patterns — checks for .aigon/worktrees/ grandparent (new) and -worktrees suffix (legacy).
- **Config restore**: Added as subcommand of existing `aigon config` in infra.js rather than standalone command to avoid conflict.
- **Doctor worktree checks**: Added three checks — missing worktree dir (auto-fixable), legacy worktree location (warning), and pruning worktrees for done features (--fix only).
- **Self-healing trust**: Single line `aigon trust-worktree "$(pwd)"` added at the top of the shell wrapper in buildAgentCommand, before cleanup function setup. Runs idempotently, errors suppressed.
- **Config auto-restore**: loadGlobalConfig detects empty/corrupt/null content AND JSON parse failures, auto-restores from config.latest.json backup.
