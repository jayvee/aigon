# Feature: modes-docs-sweep

## Summary

Phase 2 of the terminology revamp: update all documentation — README, GUIDE, command templates, and standalone docs — to use the new mode names (Drive, Fleet, Autopilot, Swarm). Depends on feature #37 (CLI rename) being complete first. Designed for **Fleet mode** — the work is highly parallelisable across files.

## The Mode Grid (reference)

```
                    One Agent          Multi-Agent
                 ┌──────────────┬──────────────────┐
  Hands-on       │    Drive     │     Fleet         │
                 ├──────────────┼──────────────────┤
  Hands-off      │  Autopilot   │     Swarm         │
                 └──────────────┴──────────────────┘
                         Autonomous
```

### Terminology mapping

| Old term | New term | Notes |
|----------|----------|-------|
| solo mode | Drive mode | Covers both branch and worktree |
| solo branch mode | Drive mode (branch) | |
| solo worktree mode | Drive mode (worktree) | |
| arena mode | Fleet mode | |
| Ralph mode / Ralph loop | Autopilot mode (one agent) or Swarm mode (multi-agent) | |
| `--ralph` | `--autonomous` | Flag already renamed in #37 |
| `AIGON_MODE=solo` | `AIGON_MODE=drive` | |
| `AIGON_MODE=arena` | `AIGON_MODE=fleet` | |

## User Stories

- [ ] As a new Aigon user reading the README, I immediately understand the four modes via the 2x2 grid and know when to use each
- [ ] As a reader of the GUIDE, the hooks documentation uses the new mode names in examples and environment variable descriptions
- [ ] As a developer running a slash command, the command's help text uses the new terminology consistently

## Acceptance Criteria

### README.md
- [ ] "Built for real multi-agent workflows" section rewritten with the 2x2 grid and mode descriptions
- [ ] All mode references throughout updated (workflow section, CLI reference, examples)
- [ ] Board legend updated with new indicators

### Command templates (15+ files in `templates/generic/commands/`)
- [ ] All references to "solo mode", "arena mode", "Ralph mode/loop" replaced
- [ ] Step-by-step instructions use new mode names
- [ ] Feature-implement template updated: "Drive mode", "Fleet mode", "Autopilot mode", "Swarm mode" in relevant sections
- [ ] Feature-setup template updated with new mode descriptions
- [ ] Feature-submit, feature-eval, feature-review templates updated
- [ ] Research-conduct, research-setup templates updated ("Research Fleet" etc.)
- [ ] Help template updated with four-mode summaries

### Standalone docs
- [ ] `docs/ralph.md` renamed to `docs/autonomous-mode.md` with Ralph attribution preserved in a "History" section
- [ ] `docs/GUIDE.md` hook documentation updated with new `AIGON_MODE` values and examples
- [ ] `docs/development_workflow.md` updated with new mode terminology

### Agent-specific docs
- [ ] `docs/agents/claude.md` updated if it references modes
- [ ] `docs/agents/cursor.md` updated if it references modes
- [ ] `AGENTS.md` template updated if it references modes

## Validation

```bash
# Verify old terms are gone from active command templates
! grep -rli 'solo mode\|arena mode\|Ralph mode\|Ralph loop' templates/generic/commands/

# Verify old terms are gone from docs (excluding done specs and changelogs)
! grep -rli 'solo mode\|arena mode\|Ralph mode\|Ralph loop' README.md docs/GUIDE.md docs/development_workflow.md

# Verify new terms are present in README
grep -q 'Drive Mode\|Drive mode' README.md
grep -q 'Fleet Mode\|Fleet mode' README.md
grep -q 'Autopilot Mode\|Autopilot mode' README.md
grep -q 'Swarm Mode\|Swarm mode' README.md

# Verify the 2x2 grid is in README
grep -q 'One Agent.*Multi-Agent' README.md

# Verify autonomous-mode.md exists (renamed from ralph.md)
test -f docs/autonomous-mode.md
```

## Technical Approach

### Fleet mode execution

This feature is designed for Fleet mode. The work splits cleanly by file group:

**Agent 1**: README.md + docs/development_workflow.md
**Agent 2**: Command templates (templates/generic/commands/*.md)
**Agent 3**: docs/GUIDE.md + docs/ralph.md → docs/autonomous-mode.md + agent docs

Each group is independent — no merge conflicts between agents.

### Replacement rules (all agents must follow exactly)

These are the exact string replacements to apply:

| Find | Replace with |
|------|-------------|
| `solo mode` | `Drive mode` |
| `Solo mode` | `Drive mode` |
| `solo branch mode` | `Drive mode (branch)` |
| `solo worktree mode` | `Drive mode (worktree)` |
| `Solo (branch)` | `Drive (branch)` |
| `Solo (worktree)` | `Drive (worktree)` |
| `arena mode` | `Fleet mode` |
| `Arena mode` | `Fleet mode` |
| `Arena Mode` | `Fleet Mode` |
| `Ralph mode` | `Autopilot mode` |
| `Ralph loop` | `autonomous loop` |
| `Ralph technique` | `autonomous technique` |
| `--ralph` (in docs/examples) | `--autonomous` |
| `🚀 Solo` | `🚗 Drive` |
| `🏟️  Arena` | `🚛 Fleet` |
| `AIGON_MODE=solo` (in docs) | `AIGON_MODE=drive` |
| `AIGON_MODE=arena` (in docs) | `AIGON_MODE=fleet` |

**Do NOT replace**: variable names in code, git branch/worktree patterns, CHANGELOG entries, done spec filenames, or historical references in the "History" section of autonomous-mode.md.

### ralph.md → autonomous-mode.md

Rename the file and add a History section at the bottom:

```markdown
## History

Autonomous mode was originally called "Ralph mode", named after the
[Ralph pattern by Geoffrey Huntley](https://ghuntley.com/ralph/) and
[similar implementations](https://github.com/minicodemonkey/chief)
that treat autonomous iteration as the primary development loop.
```

## Dependencies

- **Feature #37** (modes-and-terminology): CLI must be updated first so that `aigon` commands output new terminology. Documentation should match.

## Out of Scope

- `aigon-cli.js` changes (done in feature #37)
- Website / aigon-site changes (separate feature)
- VS Code extension terminology
- CHANGELOG updates (done as part of version bump after both features merge)

## Open Questions

- Should "Research Arena" become "Research Fleet" consistently, or do research modes use different terminology?
- Should done specs and historical logs be updated, or left as-is for historical accuracy?

## Related

- **Feature #37**: modes-and-terminology (Phase 1 — CLI, this depends on it)
- Feature: deploy-demo-update (aigon-site — website terminology, Phase 3)
- Feature #02: unify-workflow (previous rename: "bakeoff" → "arena", provides precedent for scope)
