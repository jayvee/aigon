# Feature: agent-file-standards

## Summary

The industry has converged on `AGENTS.md` (now under Linux Foundation AAIF, 60k+ projects) as the standard root instruction file for AI coding agents. Aigon should generate `AGENTS.md` as the shared root file instead of duplicating content across agent-specific files (`GEMINI.md`, `.codex/prompt.md`). Claude Code is the only holdout — it still needs `CLAUDE.md`.

## User Stories

- [ ] As a developer, I want a single `AGENTS.md` with shared project instructions so all agents (Codex, Gemini, Cursor) read the same file
- [ ] As a developer, I want `CLAUDE.md` to reference `AGENTS.md` so I know where shared instructions live
- [ ] As a developer upgrading, I want clear guidance on migrating from `GEMINI.md`/`.codex/prompt.md` to `AGENTS.md`

## Acceptance Criteria

- [ ] `aigon install-agent` creates `AGENTS.md` at project root with scaffold sections + Aigon markers
- [ ] `GEMINI.md` is no longer generated (Gemini reads AGENTS.md natively)
- [ ] `.codex/prompt.md` is no longer generated (Codex reads AGENTS.md natively)
- [ ] `CLAUDE.md` still generated (Claude doesn't read AGENTS.md) with added pointer to AGENTS.md
- [ ] `aigon update` prints migration notices when old root files are detected
- [ ] All agent commands continue to install to their agent-specific locations (no change)
- [ ] Agent doc template references AGENTS.md for project instructions

## Technical Approach

- Create `templates/generic/agents-md.md` — agent-agnostic marker template
- Generate `AGENTS.md` during `install-agent` before the per-agent loop, using existing `upsertMarkedContent()` and `getScaffoldContent()` functions
- Add `supportsAgentsMd` flag to agent configs — `true` for gg/cx/cu, `false` for cc
- Set `gg.json` `rootFile: null` and `cx.json` `extras.prompt.enabled: false`
- Update `getRootFileContent()` to include `AGENTS.md` pointer in CLAUDE.md
- Migration notices (no auto-delete) in `update` command

## Dependencies

- None (uses existing template system, marker system, and scaffold system)

## Out of Scope

- `.agents/` directory spec (AGENTS-1) — emerging but not yet widely adopted
- Moving commands/skills to standard locations — each agent has its own format
- Auto-deleting old `GEMINI.md` or `.codex/prompt.md` files

## Open Questions

- Should the scaffold content (Testing, Build, Dependencies) be removed from new `CLAUDE.md` files to avoid duplication with `AGENTS.md`? (Recommendation: keep it for now since Claude can't read AGENTS.md)

## Related

- Research: Industry standardization on AGENTS.md (Linux Foundation AAIF, Dec 2025)
- https://agents.md — official spec
- https://github.com/agentsfolder/spec — emerging .agents/ directory spec
