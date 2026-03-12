# Feature: command-vocabulary-rename

## Summary

Rename core Aigon commands to create a clearer, more consistent vocabulary across the feature, research, and feedback workflows. The key renames are: `implement` → `do`, `conduct` → `do`, `done` → `close`, and the orchestrator `conduct` → `autopilot`. Also introduces `research-submit` for Fleet mode parity with features, and `research-autopilot` as the autonomous research pipeline.

## Locked Vocabulary Table

| Stage | Feature (Drive) | Feature (Fleet) | Research (Drive) | Research (Fleet) | Feedback |
|-------|----------------|-----------------|-----------------|-----------------|----------|
| **Capture** | `feature-create` | `feature-create` | `research-create` | `research-create` | `feedback-create` |
| **Triage** | `feature-prioritise` | `feature-prioritise` | `research-prioritise` | `research-prioritise` | `feedback-triage` |
| **Prepare** | `feature-setup` | `feature-setup` | `research-setup` | `research-setup` | — |
| **Do the work** | `feature-do` | each agent: `feature-do` | `research-do` | each agent: `research-do` | — |
| **Submit for evaluation** | `feature-submit` | each agent: `feature-submit` | — | each agent: `research-submit` | — |
| **Evaluate** | — | `feature-eval` | — | `research-synthesize` | — |
| **Fix issues** | `feature-review` (optional) | `feature-review` (optional) | — | — | — |
| **Finish** | `feature-close` | `feature-close` | `research-close` | `research-close` | — |
| **Autopilot** | — | `feature-autopilot` | — | `research-autopilot` | — |

## Rename Map

| Old Command | New Command | Old Alias | New Alias |
|-------------|-------------|-----------|-----------|
| `feature-implement` | `feature-do` | `afi` | `afd` |
| `feature-done` | `feature-close` | `afd` | `afcl` |
| `research-conduct` | `research-do` | `ard` | `ard` (unchanged) |
| `research-done` | `research-close` | `ardn` | `arcl` |
| `conduct` (orchestrator) | `feature-autopilot` + `research-autopilot` | — | `afap` / `arap` |
| *(new)* | `research-submit` | — | `arsb` |

Note: `afd` currently maps to `feature-done`. After rename, `afd` maps to `feature-do` (the more frequently used command).

## User Stories

- [ ] As a user, I can use `feature-do` and `research-do` as a consistent verb for "agent does the work", replacing the inconsistent `implement` / `conduct` split
- [ ] As a user, I can use `close` instead of `done` — a proper verb that means "finish and archive"
- [ ] As a user, I can run `feature-autopilot 42 cc gg cx` to kick off a fully autonomous Fleet pipeline (setup → do → submit → eval)
- [ ] As a user, I can run `research-autopilot 08 cc gg cx` to kick off a fully autonomous Fleet research pipeline (setup → do → submit → synthesize)
- [ ] As a user, the old command names still work as aliases during a deprecation period so my muscle memory isn't broken

## Acceptance Criteria

- [ ] All 5 renames are applied in `aigon-cli.js` (command definitions, handlers, aliases, help text, error messages)
- [ ] All 4 agent configs updated (`templates/agents/cc.json`, `cu.json`, `cx.json`, `gg.json`)
- [ ] Command template files renamed and contents updated:
  - `feature-implement.md` → `feature-do.md`
  - `feature-done.md` → `feature-close.md`
  - `research-conduct.md` → `research-do.md`
  - `research-done.md` → `research-close.md`
- [ ] New command template created: `research-submit.md`
- [ ] New command templates created: `feature-autopilot.md` and `research-autopilot.md`
- [ ] Cross-references in other command templates updated (help.md, next.md, feature-now.md, feature-setup.md, research-setup.md, worktree-open.md, etc.)
- [ ] `## Prompt Suggestion` sections in all 11 command templates updated to suggest new command names (e.g. feature-setup suggests `feature-do` not `feature-implement`, research-do suggests `research-close` not `research-done`)
- [ ] Old command names registered as deprecated aliases that still work but print a deprecation warning
- [ ] `help.md` template updated with new vocabulary table, slash commands, and CLI commands
- [ ] Core documentation updated: `docs/development_workflow.md`, `docs/autonomous-mode.md`
- [ ] README.md and GUIDE.md updated with new command names
- [ ] Agent-specific docs updated: `docs/agents/claude.md`, `docs/agents/cursor.md`, `docs/agents/codex.md`, `docs/agents/gemini.md`
- [ ] `AGENTS.md` and `CLAUDE.md` updated if they reference old command names
- [ ] `research-autopilot` implemented: spawns tmux sessions, polls findings files for completion, auto-runs `research-synthesize`
- [ ] `feature-autopilot` implemented as rename of `conduct` with same logic
- [ ] `research-submit` implemented: agent writes findings and signals completion (analogous to `feature-submit`)
- [ ] `node -c aigon-cli.js` passes (syntax check)
- [ ] All aliases resolve correctly (`aigon afd`, `aigon afcl`, `aigon ard`, `aigon arcl`, `aigon afap`, `aigon arap`)

## Validation

```bash
node -c aigon-cli.js
```

## Technical Approach

### Phase 1: Renames (bulk find-and-replace)

1. Rename command template files in `templates/generic/commands/`
2. Update all references in `aigon-cli.js`:
   - Command definitions object (keys)
   - Command handlers object (keys)
   - Alias map
   - Help text and usage strings
   - Error messages and prompt suggestions
   - Internal function names (e.g. `buildResearchConductPrompt` → `buildResearchDoPrompt`)
3. Update agent config files (implementPrompt, commands arrays)
4. Update cross-references in all other command templates
5. Add deprecated aliases that map old names → new names with a console.warn

### Phase 2: New commands

1. **`research-submit`**: Modelled on `feature-submit`. Agent writes findings to their file and updates a status marker so the autopilot monitor can detect completion.
2. **`research-autopilot`**: Modelled on the existing `conduct` handler. Spawns tmux sessions running `research-do` for each agent, polls findings files for `submitted` status, then auto-runs `research-synthesize`.
3. **`feature-autopilot`**: Rename of `conduct` handler. Same logic, new name.

### Phase 3: Documentation

1. Update all docs files with new command names
2. Update the vocabulary table in help.md to match the locked table above
3. Do NOT update historical feature specs/logs in `docs/specs/features/05-done/` or `docs/specs/research-topics/04-done/` — these are historical records

### Phase 4: Aigon-site changes (separate feature)

Create a follow-up feature for aigon.build website documentation updates.

## Dependencies

- None — this is a rename/restructure of existing functionality

## Out of Scope

- Aigon.build website changes (separate feature: `aigon-site-vocabulary-update`)
- Renaming `feature-eval` or `research-synthesize` (these are genuinely different actions and keep their names)
- Renaming `feature-review` (stays as-is)
- Changing historical spec files in `05-done/` or `04-done/`
- Changes to the `conductor` daemon (`aigon conductor start/stop/status`) — that's infrastructure, not workflow vocabulary
- CHANGELOG.md — will be updated at release time, not during this feature

## Open Questions

- Should the deprecation period have a version cutoff (e.g. remove old aliases in v3.0)?
- Should `feature-now` be renamed to `feature-fasttrack` or similar for consistency? (Currently out of scope)

## Related

- Discussion: conversation about command vocabulary, Drive/Fleet pathways, and autonomous orchestration terminology
- Existing `conduct` command: `aigon-cli.js:7951`
- Autonomous mode docs: `docs/autonomous-mode.md`
