# Research: Gemini CLI Worktree Sandbox — Why Reviews Fail and How to Fix

## Context

Gemini CLI (`gemini`) cannot review code in git worktrees. It reports "security constraints prevent me from accessing files outside the main project workspace" even when:
- The tmux session starts in the worktree directory (verified with `pwd`)
- `GEMINI_CLI_IDE_WORKSPACE_PATH` is set to the worktree path
- The worktree parent directory is in `~/.gemini/trustedFolders.json` as `TRUST_PARENT`
- The `cd` command in the shell trap explicitly changes to the worktree

Meanwhile, Gemini CLI works fine for **implementation** when launched via `feature-start` inside a worktree. The difference: implementation sessions are spawned directly in the worktree, while review sessions are launched from the dashboard server process.

**This blocks multi-agent review** — a core aigon workflow where a different agent reviews the implementing agent's code.

## Hypothesis

Gemini CLI determines its project root by following `.git`. In a worktree, `.git` is a file containing `gitdir: /path/to/main-repo/.git/worktrees/<name>`. Gemini follows this pointer back to the main repo and sandboxes to that directory. The cwd, env vars, and trust settings are all overridden by this `.git` resolution.

## Questions to Answer

- [ ] How does Gemini CLI determine its project root / sandbox boundary? Is it `.git` resolution, `package.json` location, or something else?
- [ ] Does `GEMINI_CLI_IDE_WORKSPACE_PATH` actually work when set before launch? Test in isolation outside aigon.
- [ ] Does `--include-directories` flag allow access to the worktree path when launched from main?
- [ ] When `feature-start` launches gg inside a worktree, does it work because the `.git` file points to the same main repo? Or does it work for a different reason?
- [ ] Is there a Gemini CLI config option to override the project root?
- [ ] Does creating a symlink from `.git` to a real `.git` directory (not a worktree pointer) fix the sandbox?
- [ ] Would running `git init` in the worktree (making it a standalone repo) fix the sandbox? What breaks?
- [ ] Do other CLI agents (Codex, Cursor) have the same worktree sandbox issue?
- [ ] Is this a known Gemini CLI issue with a tracked bug or workaround?

## Scope

### In Scope
- Gemini CLI sandbox/workspace detection mechanism
- Git worktree `.git` file handling across all agent CLIs
- Workarounds that don't require modifying Gemini CLI source
- Whether `--include-directories` solves this
- Testing implementation vs review launch paths to isolate the difference

### Out of Scope
- Modifying Gemini CLI source code
- Other Gemini CLI issues unrelated to worktrees
- Alternative review approaches that don't use the agent CLI

## Test Plan

1. **Baseline**: Launch `gemini` directly from a worktree directory — can it read files?
2. **Env var test**: `export GEMINI_CLI_IDE_WORKSPACE_PATH=/worktree/path && gemini` — does it respect it?
3. **Include dirs test**: `gemini --include-directories /worktree/path` — does it bypass sandbox?
4. **Implementation path**: Trace exactly how `feature-start 999 gg` launches gg and why it works
5. **Review path**: Trace exactly how `handleLaunchReview` launches gg and why it fails
6. **Compare**: What's different between the two launch paths that makes one work and the other fail?

## Findings
<!-- To be filled during research -->

## Recommendation
<!-- To be filled after research -->

## Output
- [ ] Feature: fix or workaround for Gemini worktree reviews, OR document gg as implementation-only agent
