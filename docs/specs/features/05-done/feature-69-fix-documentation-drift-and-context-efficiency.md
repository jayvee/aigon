# Feature: Fix Documentation Drift and Context Efficiency

## Summary

Agent instruction files have drifted significantly from the current codebase: stale command names that don't exist, empty build/run sections, and an architecture doc that describes a module structure that doesn't exist yet. Separately, the three largest files (`lib/utils.js` at 8,530 lines, `lib/commands/shared.js` at 6,877 lines, `templates/dashboard/index.html` at 3,666 lines) have no internal navigation, forcing agents to load everything to find anything. Both problems directly reduce agent effectiveness — stale docs cause agents to run commands that fail; unindexed large files waste context window on irrelevant code.

## User Stories

- [ ] As an agent reading `docs/agents/claude.md`, I can follow the workflow steps and run commands that actually exist in the CLI
- [ ] As an agent starting a new session, I can read `AGENTS.md` and know exactly how to start the dev server, run tests, and install dependencies — without hunting through CLAUDE.md
- [ ] As an agent about to edit validation logic, I can read `docs/architecture.md` and know exactly where to find it (which file, which line range) without opening and scanning the file
- [ ] As an agent editing `lib/utils.js`, I can read a navigation index at the top and jump to the right section in under 5 seconds
- [ ] As an agent editing the dashboard JS, I can find the relevant section from a table of contents comment without reading 3,600 lines

## Acceptance Criteria

### AGENTS.md — fill in empty sections

- [ ] `## Testing` contains: `npm test` and any known gaps
- [ ] `## Build & Run` contains: how to start radar (`node aigon-cli.js radar start`), the restart rule for backend vs frontend changes (backend changes require `radar stop && radar start`; HTML template changes do not), and how to open the dashboard (`node aigon-cli.js radar open`)
- [ ] `## Dependencies` contains: `npm install`

### docs/agents/claude.md — fix stale command names

- [ ] Command table reflects current CLI: `feature-do`, `feature-submit`, `feature-close`, `feature-eval`, `feature-review`, `feature-autopilot`
- [ ] Remove `feature-implement`, `feature-done`, `feature-cleanup` references (or mark removed)
- [ ] Remove `ralph` slash command reference (replaced by `feature-do --autonomous`)
- [ ] Solo/Arena workflow steps updated to use current commands
- [ ] Terminology updated: Solo→Drive, Arena→Fleet where appropriate (changed in feature 37)

### docs/development_workflow.md — fix stale command names

- [ ] Command reference table updated to current CLI
- [ ] Workflow steps updated
- [ ] Drive/Fleet terminology used consistently

### docs/architecture.md — honest module descriptions

- [ ] Module descriptions reflect current reality: all `lib/*.js` domain modules are re-export facades; actual logic lives in `lib/utils.js`
- [ ] Each module entry notes approximately where its logic lives in `lib/utils.js` (line range)
- [ ] Note that feature 68 will move logic into these modules

### lib/utils.js — navigation index

- [ ] Comment block immediately after `'use strict'` lists every major function domain with line numbers:
```
// ── NAVIGATION ────────────────────────────────────────────────────
// Editor / agent detection         ~11
// Config & profiles                ~223
// Port / proxy / dev-server        ~576
// AIGON server & registry          ~1112
// Dashboard status collection      ~1187
// Dashboard HTML builder           ~1720
// Analytics & completion series    ~5611
// Feedback                         ~4673
// Generic CRUD (findFile, moveFile) ~5203
// Templates & agent config         ~6272
// Board rendering                  ~6531
// Git utilities                    ~6070
// Validation & Ralph               ~7017
// Deploy                           ~8206
// ─────────────────────────────────────────────────────────────────
```

### lib/commands/shared.js — navigation index

- [ ] Same treatment: comment block at top listing command groups with line numbers

### templates/dashboard/index.html — JS section index

- [ ] Comment block near the top of the `<script>` tag lists major JS sections with approximate line offsets (state, polling, rendering functions per view, action handlers, WebSocket/terminal relay)

## Validation

```bash
node -c aigon-cli.js
node aigon-cli.js help | grep "feature-"
```

Manual: read `docs/agents/claude.md` top-to-bottom and verify every command mentioned appears in `node aigon-cli.js help` output.

## Technical Approach

All changes are documentation and comments — no logic changes.

1. Run `node aigon-cli.js help` to get the authoritative current command list
2. Update `AGENTS.md`, `docs/agents/claude.md`, `docs/development_workflow.md`, `docs/architecture.md`
3. Add navigation index to `lib/utils.js`: use `grep -n "^function " lib/utils.js` to generate line numbers
4. Add navigation index to `lib/commands/shared.js`: same
5. Add JS TOC comment to `templates/dashboard/index.html`

## Dependencies

None.

## Out of Scope

- Changing any command behaviour
- Moving logic between files (that's feature 68)
- Updating templates installed into other projects (separate `aigon update` concern)
- Adding new documentation pages

## Related

- Feature 68: complete-cli-modularization — architecture.md module descriptions will need updating again after that lands
