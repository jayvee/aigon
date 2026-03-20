# Feature: rename-setup-to-start

## Summary

Rename `feature-setup` → `feature-start` and `research-setup` → `research-start` across the entire codebase. The current "setup" implies preparation without action, but the command actually creates workspaces AND launches agents. "Start" accurately describes what happens: the feature begins. This also unifies the CLI and dashboard flows — both become a single "start" action that sets up the workspace and opens agent terminals.

## Motivation

- "Setup" implies a prerequisite step before the real action. Users expect a separate "open" step that may not be needed.
- The dashboard already chains setup + open into one click. The CLI should match.
- The verb progression becomes clean: create → prioritise → **start** → evaluate → close
- "Start" is the natural opposite of "close"

## Acceptance Criteria

### Command Rename
- [ ] `feature-setup` renamed to `feature-start` in CLI handler (`lib/commands/feature.js`)
- [ ] `research-setup` renamed to `research-start` in CLI handler (`lib/commands/research.js`)
- [ ] Both commands create workspace AND open agent terminals (no separate open step needed for first launch)
- [ ] `feature-open` / `research-open` retained as re-attach/restart for existing sessions only

### State Machine
- [ ] Transition action `feature-setup` → `feature-start` in `FEATURE_TRANSITIONS`
- [ ] Transition action `research-setup` → `research-start` in `RESEARCH_TRANSITIONS`
- [ ] `TRANSITIONS_AS_BUTTONS` updated in dashboard actions.js

### Dashboard
- [ ] `actions.js` dispatch cases updated: `feature-start`, `research-start`
- [ ] Dashboard dispatch simplified — `feature-start` CLI command handles the open, no need to chain `requestFeatureOpen` per agent
- [ ] Button label on backlog cards changes from "Setup" to "Start"
- [ ] Agent picker modal submit button says "Start Agents" (Fleet) or "Start" (Drive)
- [ ] `pipeline.js` and `logs.js` references updated

### Templates
- [ ] `feature-setup.md` → `feature-start.md` (rename file + update content)
- [ ] `research-setup.md` → `research-start.md` (rename file + update content)
- [ ] All templates referencing "feature-setup" or "research-setup" updated (~10 files: help, prioritise, close, do, now, autopilot, agent docs, skill.md, development_workflow.md)

### Agent Configs
- [ ] `cc.json`, `gg.json`, `cx.json`, `cu.json` — update command registry entries

### Command Registry & Shortcuts
- [ ] `COMMAND_REGISTRY` in `lib/templates.js` updated
- [ ] Slash command shortcuts: `afse` → reassign (see note below)
- [ ] `arse` → reassign for research-start
- [ ] `lib/utils.js` references updated

### Behavioral Change
- [ ] `feature-start` creates worktree/branch AND opens terminal with agent command (chains current setup + open)
- [ ] For Drive worktree/Fleet: opens terminal windows for each agent after workspace creation
- [ ] For Drive branch (no agent specified): creates branch only, no terminal to open (same as current setup)
- [ ] Running `feature-start` on an already in-progress feature prints clear message: "Feature 116 is already running. Use `feature-open` to re-attach."

### Documentation
- [ ] `docs/development_workflow.md` updated via template
- [ ] `docs/agents/*.md` updated via install-agent
- [ ] `AGENTS.md` not touched (scaffolded once, never overwritten)

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/state-machine.js
node -c lib/dashboard-server.js
npm test
```

## Technical Approach

This is primarily a rename with one behavioral change (chaining open after setup). Suggested order:

1. **State machine** — rename transition actions (smallest blast radius, everything else depends on this)
2. **Command handlers** — rename in `feature.js` and `research.js`, add terminal-open chaining
3. **Dashboard** — update `actions.js` dispatch, simplify by removing `requestFeatureOpen` chain
4. **Templates** — rename files, update all references
5. **Agent configs + registry** — update `COMMAND_REGISTRY` and agent JSON files
6. **Install + test** — `aigon install-agent cc`, verify slash commands work

### Shortcut Conflict

`afs` is taken by `feature-submit`. Options (pick one during implementation):
- Give `afs` to `feature-start` (more commonly typed by users), reassign submit to `afsb`
- Use `afst` for start
- Use `afgo` for start (short, punchy)

Recommendation: `afs` → `feature-start`, `afsb` → `feature-submit`. Users type start often; submit is mostly agent-internal.

## Dependencies

- None. Pure rename + minor behavioral change.

## Out of Scope

- Renaming `feature-open` to `feature-attach` (could be a follow-up)
- Changing feedback workflow verbs (already clean)
- Changing `feature-now` (it would internally call `feature-start` instead of `feature-setup`, but the user-facing name stays)

## Sizing

~30 files, ~100 references. Mostly string replacements. Good candidate for Fleet (2-3 agents doing coordinated rename) but also doable in Drive since it's mechanical.

## Related

- Feature 116 (worktree-env-isolation) — discovered during same session
- Dashboard UX gap: backlog→in-progress transition didn't show agent start buttons
