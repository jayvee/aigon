---
commit_count: 5
lines_added: 261
lines_removed: 41
lines_changed: 302
files_touched: 7
fix_commit_count: 1
fix_commit_ratio: 0.2
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
---
# Implementation Log: Feature 142 - installation-docs-overhaul
Agent: cc

## Plan

Three-part implementation: documentation overhaul, CLI enhancements, and cross-document reconciliation.

## Progress

- [x] Verified correct npm package names: `@google/gemini-cli` (was `@anthropic-ai/gemini-cli`), `@openai/codex` (correct), `brew install claude` (correct)
- [x] Rewrote `site/content/getting-started.mdx` — prerequisites, platform tabs, clone guidance, agent CLI table fixes, seed repo walkthrough, doctor mention
- [x] Updated `README.md` — prerequisites one-liner, corrected clone path
- [x] Reconciled `docs/linux-install.md` — consistent tmux framing, cross-reference to getting-started, removed incorrect `npm install -g aigon`
- [x] Added prerequisites section to `aigon doctor` — checks Node.js version, Git, tmux, and all agent CLIs in PATH
- [x] Added CLI binary verification to `install-agent` — soft-warns when agent binary not in PATH
- [x] Added `engines` field to `package.json`

## Decisions

- **tmux framing**: Settled on "required for Fleet/worktree mode, optional for single-agent Drive mode" — used consistently across all docs
- **linux-install.md kept separate**: Not merged into getting-started; instead added cross-reference. Linux-specific content (terminal emulators, xdg-open, Caddy install) is substantial enough to warrant its own page
- **install-agent soft-warns, doesn't block**: Agent config files are still installed even if the CLI binary is missing. This lets users install the binary later without re-running install-agent
- **Plain markdown for platform sections**: Used header-based platform sections instead of MDX tab components, matching the existing style of the docs site (no component imports in any .mdx file)
- **Doctor uses `isBinaryAvailable` from security.js**: Reuses existing utility rather than reimplementing `which`/`command -v`

## Code Review

**Reviewed by**: cx
**Date**: 2026-03-24

### Findings
- The new getting-started docs listed Cursor's CLI binary as `cursor`, but Aigon's actual configured Cursor command is `agent`.
- `aigon doctor` had the same mismatch: it checked for `cursor` while `install-agent` checks the configured binary (`agent`).
- On Linux, doctor also printed a second tmux check with stronger wording that contradicted the new "required for Fleet/worktree mode, optional for single-agent Drive mode" framing.

### Fixes Applied
- `e0fbef66` `fix(review): align Cursor CLI docs and doctor checks`

### Notes
- The review fix aligns the docs and doctor output with the real Cursor CLI command and removes the contradictory duplicate tmux wording from the Linux-specific doctor section.
- Added a regression test in `aigon-cli.test.js` to verify doctor reports `agent (cu)` rather than `cursor (cu)`.
