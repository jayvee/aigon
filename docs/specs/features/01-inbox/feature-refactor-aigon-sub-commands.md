# Feature: Refactor Aigon Sub-Commands to Reduce Complexity

## Summary

Aigon commands are currently defined 3 times — once each for Claude (.claude/commands/), Gemini (.gemini/commands/aigon/), and Cursor (.cursor/commands/). This results in 54+ files expressing the same 18 commands in slightly different formats. Changes require hand-editing all three, and they drift out of sync. This feature consolidates command definitions into a single source of truth with generated agent-specific variants.

## User Stories

- [ ] As a developer, I want to edit an Aigon command once and have all agent variants update automatically, so changes don't require triple-editing
- [ ] As a developer, I want feature and research commands to share common patterns (state machine, solo/arena branching) so bug fixes apply everywhere
- [ ] As a developer, I want to add a new agent IDE (e.g. Windsurf) by adding a formatter, not by hand-writing 18 new command files

## Acceptance Criteria

- [ ] Single canonical definition for each of the 18 Aigon commands in a new `docs/aigon/commands/` directory (or similar)
- [ ] A generation script that produces `.claude/commands/aigon-*.md`, `.gemini/commands/aigon/*.toml`, and `.cursor/commands/aigon-*.md` from the canonical definitions
- [ ] Generated output matches current command behaviour (no functional changes)
- [ ] Shared template fragments for: state-machine transitions (inbox/backlog/in-progress/done), solo vs arena mode branching, spec file resolution
- [ ] `.claude/skills/aigon/SKILL.md` is also generated or references canonical definitions
- [ ] A `make aigon` or `npm run aigon:generate` command to regenerate all variants
- [ ] Documentation updated: `docs/development_workflow.md` and `docs/agents/claude.md` reference the new source-of-truth location

## Technical Approach

### Canonical Command Format

Define each command as a structured markdown or YAML file:

```
docs/aigon/commands/
├── feature-create.md
├── feature-prioritise.md
├── feature-setup.md
├── ...
├── research-create.md
├── ...
├── _partials/
│   ├── state-machine.md      # inbox → backlog → in-progress → done
│   ├── solo-arena-branch.md   # solo vs arena mode detection
│   └── spec-resolution.md     # find spec file by ID
└── generate.ts                # generation script
```

### Generation Strategy

- Parse canonical markdown → extract structured sections (description, steps, mode logic)
- Apply agent-specific formatters:
  - **Claude/Cursor**: Markdown with `{{args}}` placeholders
  - **Gemini**: TOML with `<args>` format
- Inject shared partials where referenced
- Write to agent-specific output directories

### Shared Patterns to Extract

1. **Spec file resolution**: "Find the spec matching `feature-<ID>-*.md` in the appropriate folder" — appears in ~10 commands
2. **Solo/Arena detection**: "If agents are provided, use arena mode" — appears in setup, implement, eval, done, cleanup
3. **State transitions**: Moving files between `01-inbox/` through `05-done/` — appears in prioritise, setup, done for both feature and research
4. **Log file management**: Creating/updating implementation logs — appears in implement, done

## Dependencies

- Current command files in `.claude/`, `.gemini/`, `.cursor/` (will be replaced by generated output)
- Node.js / TypeScript (for the generation script)

## Out of Scope

- Changing Aigon command behaviour or adding new commands (this is a pure refactor)
- Migrating away from prompt-based commands to a CLI backend
- Adding new agent IDE support (just making it possible)
- Changing the `docs/specs/` directory structure

## Open Questions

- Should canonical definitions use markdown with frontmatter, or pure YAML/JSON?
- Should generated files have a "DO NOT EDIT — generated from docs/aigon/commands/" header?
- Should the generation script validate that all partials are resolved (no dangling references)?
- Is `.claude/skills/aigon/SKILL.md` worth generating, or is it simple enough to maintain by hand?

## Related

- Current implementations: `.claude/commands/aigon-*.md`, `.gemini/commands/aigon/*.toml`, `.cursor/commands/aigon-*.md`
- Workflow docs: `docs/development_workflow.md`
- Agent config: `docs/agents/claude.md`
