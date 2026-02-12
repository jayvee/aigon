# Feature: README Uplift

## Summary

Comprehensive overhaul of the README.md to reflect the current state of Aigon, improve discoverability through screenshots, use slash commands as the primary interaction model, add workflow examples for all modes, and position Aigon's unique value proposition prominently.

## User Stories

- [ ] As a new user, I want to understand why I'd use Aigon over a vendor-specific IDE so I can make an informed decision
- [ ] As a new user, I want to see screenshots of Aigon in action so I can quickly understand what it does
- [ ] As a user, I want the README examples to show slash commands (not just CLI) since that's how I actually use Aigon day-to-day
- [ ] As a user, I want sample workflows for solo, arena, worktree, and research modes so I can follow along
- [ ] As a user, I want to know how to update Aigon and understand that it safely preserves my custom content
- [ ] As a user, I want to know how to extend agent instructions with project-specific guidance
- [ ] As a user, I want to understand that my feature history stays in my repo, giving AI agents context for future work

## Acceptance Criteria

### Content Updates
- [ ] **Value proposition statement** added near the top explaining: CLI-based, vendor-independent, works with any agent, no lock-in
- [ ] **Context-in-repo advantage** explained: all feature specs, research, logs, and evaluations live in your repo — AI agents can use this history as context for future development, unlike third-party tools where context is locked away
- [ ] **Slash commands as primary** — all workflow examples default to slash command syntax (e.g. `/aigon:feature-create dark-mode`) with CLI equivalents shown as secondary/reference
- [ ] **Cursor CLI support** documented — explain `agent` CLI command and Cursor's `composer` model are now supported, show in agent table
- [ ] **Installation & Setup** updated:
  - How to update Aigon (`aigon update`) with explanation of AIGON_START/END marker system that preserves custom content
  - Screenshot placeholders for multi-agent install output
- [ ] **Project-specific agent instructions** — section explaining how to add custom instructions outside `<!-- AIGON_START/END -->` markers in CLAUDE.md, GEMINI.md, etc.
- [ ] **Sample Workflow Chat** reviewed and updated — ensure it reflects current command naming and slash command style
- [ ] **Additional workflow examples** added:
  - Solo development example (branch mode, fast-track)
  - Arena mode competition example (showing worktree-open, side-by-side Warp)
  - Multi-agent research example (create → conduct → synthesize)
  - Worktree workflow example (parallel feature development)
- [ ] **Agent slash commands** audited — ensure all four agent sections (Claude, Gemini, Codex, Cursor) list the correct commands. Note: `research-open` and `worktree-open` exist as templates but are missing from the README slash command tables
- [ ] **Slash command naming** verified — confirm `/aigon:` prefix for Claude/Gemini, `/aigon-` for Cursor, `/prompts:aigon-` for Codex are all correctly documented

### Screenshots & Visual Aids
- [ ] Screenshot placeholders added with descriptive filenames. Suggested placements:
  - `docs/images/aigon-init-output.png` — terminal output of `aigon init` on a fresh project
  - `docs/images/aigon-install-agents.png` — terminal output showing multi-agent install (`aigon install-agent cc gg cx cu`)
  - `docs/images/aigon-feature-list.png` — output of `aigon feature-list --all` showing features in different states
  - `docs/images/aigon-warp-arena-split.png` — Warp terminal with 3 agents side-by-side in split panes
  - `docs/images/aigon-worktree-open.png` — terminal showing `worktree-open --all` launching agents
  - `docs/images/aigon-slash-commands-menu.png` — Claude Code slash command menu showing `/aigon:` commands
  - `docs/images/aigon-feature-eval-output.png` — evaluation comparison table from a real arena run
  - `docs/images/aigon-specs-folder-structure.png` — file tree of `docs/specs/` showing the Kanban folders
  - `docs/images/aigon-update-markers.png` — showing AIGON_START/END markers in a CLAUDE.md with custom content preserved
- [ ] Image placeholders use markdown syntax: `![Alt text](docs/images/filename.png)` so they're ready to drop in

### Structure & Organisation
- [ ] Table of Contents updated to reflect any new sections
- [ ] Sections reordered if needed for better flow (value prop near top, getting started early, advanced topics later)

## Technical Approach

This is a documentation-only feature — no code changes to `aigon-cli.js` or templates. The work involves:

1. **Audit phase**: Compare README content against actual CLI capabilities, templates, and agent configs to identify all gaps
2. **Restructure**: Reorder sections for better narrative flow — lead with "why", then "quick start", then detailed reference
3. **Rewrite examples**: Convert CLI-first examples to slash-command-first, keeping CLI as secondary reference
4. **Add new sections**: Value proposition, context-in-repo, extending instructions, update workflow
5. **Add workflow examples**: Write realistic chat-style examples for each mode
6. **Screenshot placeholders**: Create `docs/images/` directory, add placeholder references throughout
7. **Verify slash commands**: Cross-reference all four agent command tables against `templates/generic/commands/` directory

### Key Gaps Identified During Analysis
- `research-open` template exists but is NOT listed in any agent's slash command table in README
- `worktree-open` template exists but is NOT listed in agent slash command tables (only in CLI Reference)
- Cursor section doesn't mention the `agent` CLI command or composer model
- No screenshots or images exist anywhere in the README currently
- README uses CLI commands as primary interaction; slash commands are secondary
- No explanation of how to extend agent instructions with project-specific content
- No explanation of the update/marker system
- No "why Aigon" section at the top

## Dependencies

- User needs to provide actual screenshots for the placeholder locations
- No code dependencies — purely documentation

## Out of Scope

- Changes to `aigon-cli.js` or template files
- Creating the actual screenshot image files (user will provide these)
- Rewriting the hooks or evaluation sections (these appear current)
- Adding a separate getting-started guide or tutorial page

## Open Questions

- Should the README be split into multiple files (e.g. separate GETTING_STARTED.md, ADVANCED.md) or kept as one comprehensive file?
- Should we add a "Quick Start" section that shows the fastest path (feature-now) before the full workflow?
- How many sample workflow examples is too many — should some go in a separate `docs/examples.md`?
- Should we add badges (npm version, license, etc.) at the top?

## Related

- Current README.md (852 lines) — primary file to be modified
- `templates/generic/commands/` — source of truth for slash commands (19 templates)
- `templates/agents/*.json` — agent configuration files (cc, cu, gg, cx)
