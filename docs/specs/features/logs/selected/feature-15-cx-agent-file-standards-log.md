# Implementation Log: Feature 15 - agent-file-standards
Agent: cx

## Plan
- Implement acceptance criteria directly in the CLI/template source of truth, then verify behavior with temporary project smoke tests.
- Add shared `AGENTS.md` generation first in `install-agent` so every installation gets a standard root instruction file.
- Preserve Claude compatibility by continuing to generate `CLAUDE.md` and adding an explicit pointer to `AGENTS.md`.
- Remove generation paths for `GEMINI.md` and `.codex/prompt.md` while preserving migration safety through non-destructive notices in `update`.

## Progress
- Added shared root template `templates/generic/agents-md.md` and wired `install-agent` to create/update `AGENTS.md` with scaffold + Aigon markers (`aigon-cli.js`, `syncAgentsMdFile()`).
- Updated root-file content for Claude to include:
  - shared project instructions in `AGENTS.md`
  - Claude-specific notes in `docs/agents/claude.md`
  - workflow docs in `docs/development_workflow.md`
- Updated agent configs:
  - `templates/agents/gg.json`: `rootFile: null`, `supportsAgentsMd: true`
  - `templates/agents/cx.json`: `extras.prompt.enabled: false`, `supportsAgentsMd: true`
  - `templates/agents/cu.json`: `supportsAgentsMd: true`
  - `templates/agents/cc.json`: `supportsAgentsMd: false`
- Updated `aigon update` detection logic to infer installed agents from generated artifacts (docs/commands/settings/config files), and added migration notices when legacy `GEMINI.md` or `.codex/prompt.md` are found (no auto-delete).
- Updated guidance templates/docs to reference `AGENTS.md` for shared project instructions:
  - `templates/generic/docs/agent.md`
  - `templates/generic/commands/feature-implement.md`
  - `README.md`
  - `docs/GUIDE.md`
- Added `AGENTS.md` to `.gitignore`.
- Validation completed:
  - `node --check aigon-cli.js` (syntax)
  - Temp install smoke test (`install-agent gg cx`) confirms:
    - `AGENTS.md` created
    - `GEMINI.md` not created
    - `.codex/prompt.md` not created
  - Temp Claude smoke test (`install-agent cc`) confirms:
    - `CLAUDE.md` still created
    - `CLAUDE.md` contains pointer to `AGENTS.md`
  - Temp update smoke test with legacy files confirms:
    - migration notices printed
    - legacy files preserved (not auto-deleted)

## Decisions
- Kept `CLAUDE.md` generation as a compatibility bridge because Claude does not natively consume `AGENTS.md`; added an explicit pointer so shared instructions stay centralized.
- Introduced `supportsAgentsMd` in agent configs (as requested in the spec) for explicit capability metadata, even though current logic does not branch on the field yet.
- Chose non-destructive migration behavior (notice only) to avoid deleting user-maintained legacy files unexpectedly.
- Expanded update-time agent detection to reduce coupling to legacy root files and ensure `gg`/`cx` still get updated after migration.
- Left command install locations unchanged (`.claude/`, `.gemini/`, `.cursor/`, `~/.codex/prompts/`) per acceptance criteria.
- Encountered a sandbox write-permission issue when a smoke test attempted to write to the real home prompt directory (`~/.codex/prompts`); resolved during validation by overriding `HOME` to a temporary directory.
