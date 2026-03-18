# Feature: improve-agents-md-for-ai-context

## Summary
Rewrite `AGENTS.md` from a 50-line generic stub into an 80-100 line fast orientation guide that gives AI agents a mental model of the codebase in under 3 minutes. Currently agents waste significant context and time exploring the codebase because AGENTS.md doesn't explain the module structure, the ctx pattern, or common pitfalls. The excellent `docs/architecture.md` exists but agents often skip it. AGENTS.md should be the essential map that makes architecture.md optional for quick tasks.

## User Stories
- [ ] As an AI agent, I want to know the module structure and ctx pattern before I start editing code
- [ ] As an AI agent, I want to know the 5 most common mistakes so I don't repeat them
- [ ] As a user, I want agents to orient in 2-3 minutes instead of 10+ minutes of exploratory file reads

## Acceptance Criteria
- [ ] AGENTS.md rewritten with these sections (in order):
  1. **Quick Facts** (~10 lines) — CLI entry point, module count, LOC, command grouping, template source-of-truth
  2. **The ctx Pattern** (~20 lines) — how dependency injection works, code example showing `ctx.git`, `ctx.utils`, why it exists
  3. **Module Map** (~15 lines) — table of key modules with line counts and what each owns
  4. **Where To Add Code** (~10 lines) — decision tree: new command → `lib/commands/{domain}.js`, shared logic → `lib/{domain}.js`, constants → `lib/constants.js`, templates → `templates/`
  5. **Five Rules Before Editing** (~10 lines) — use exact user args, filter .env.local, screenshot dashboard changes, restart server after backend edits, never move spec files manually
  6. **Common Agent Mistakes** (~8 lines) — inventing args, breaking dashboard without visual check, adding complexity when asked to simplify, uncommitted .env.local blocking, template edits not synced
  7. **Reading Order** (~5 lines) — architecture.md for CLI, development_workflow.md for workflow, agents/{id}.md for agent-specific
- [ ] Total length between 80-100 lines (concise, not verbose)
- [ ] Module map table reflects actual current file structure (post-features 85-89)
- [ ] ctx pattern example uses real function names from the codebase
- [ ] Feedback items from memory (`feedback_dont_invent_args.md`, `feedback_env_local_ignored.md`, `feedback_radar_simplification.md`, `feedback_use_playwright_to_verify.md`) incorporated into rules/mistakes sections
- [ ] `docs/architecture.md` updated if module map has drifted (line counts, new modules from features 85-89)
- [ ] CLAUDE.md still references AGENTS.md correctly

## Validation
```bash
# Verify AGENTS.md exists and is reasonable length
test $(wc -l < AGENTS.md) -gt 70
test $(wc -l < AGENTS.md) -lt 120
# Verify key sections exist
grep -q "ctx Pattern" AGENTS.md
grep -q "Module Map" AGENTS.md
grep -q "Five Rules" AGENTS.md
```

## Technical Approach

### What to write
AGENTS.md is read by every agent on every session start. It should be:
- **Scannable** — headers, tables, bullet points. No prose paragraphs.
- **Actionable** — "do this, don't do that" not "the architecture evolved from..."
- **Current** — reflects post-refactoring module structure (features 85-89)
- **Concise** — 80-100 lines. Everything beyond that belongs in architecture.md

### What NOT to include
- Full function listings (that's architecture.md)
- Workflow instructions (that's development_workflow.md and command templates)
- Agent-specific config (that's docs/agents/{id}.md)
- Historical context (that's done specs and commit history)

### Module map source
Run `wc -l lib/*.js lib/commands/*.js` to get current line counts. The map should list the 8-10 most important modules, not all 29.

### Feedback integration
The memory files contain real incidents. Distill each into a one-line rule:
- "Don't add agents to commands the user didn't specify" (from feature-84 incident)
- "Filter .env.local from git status checks" (from recurring feature-close blocks)
- "Screenshot dashboard after HTML changes" (from broken dashboard shipping)
- "When told to simplify, remove code, don't add smarter code" (from radar simplification)

## Dependencies
- Feature 91 (fix ctx regressions) — should be done first so module map is accurate
- Features 85-89 should be merged so the module structure is final

## Out of Scope
- Rewriting docs/architecture.md (just update the module map table if stale)
- Changing the CLAUDE.md auto-generation system
- Adding onboarding for non-aigon projects (this is aigon-specific)

## Open Questions
- Should the module map include line counts? They go stale quickly but are useful for orientation.
- Should AGENTS.md be auto-generated from code (grep module.exports, count lines) or hand-maintained?

## Related
- `docs/architecture.md` — detailed architecture reference (172 lines)
- `docs/development_workflow.md` — workflow guide (98 lines)
- Memory feedback files in `~/.claude/projects/-Users-jviner-src-aigon/memory/`
- Feature 87: restructure-command-system (introduced the ctx pattern)
