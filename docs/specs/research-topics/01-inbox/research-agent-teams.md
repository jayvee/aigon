# Research: agent-teams

## Context

Claude Code has introduced "Agent Teams" — the ability to define team members with specialist roles that can be invoked as subagents. These specialists can be reactive to code changes and handle tasks like updating docs, writing tests, or enforcing guidelines.

Aigon currently orchestrates multiple agents (cc, gg, cx, cu) in arena mode competing on the same feature, but has no concept of **specialist team members within a single agent session** — agents that collaborate rather than compete, each owning a different concern.

Making this concept generic across supported agents would be valuable. Rather than being Claude Code-specific, Aigon could define team compositions in feature specs or project config, then translate them to each agent's native team/subagent system.

### Example Use Cases

Specialist team members that react to code changes:
- **Docs agent** — updates internal documentation
- **Customer docs agent** — updates external/customer-facing docs
- **Architecture agent** — updates architecture diagrams
- **Meta agent** — updates agent instructions based on recent interactions
- **Style agent** — ensures frontend guidelines are adhered to
- **Test agent** — builds new tests as required

## Questions to Answer

### Agent Ecosystem Support
- [ ] How does Claude Code's Agent Teams feature work in detail (definition, invocation, lifecycle)?
- [ ] Does Cursor support any form of specialist subagents or team roles?
- [ ] Does Gemini CLI support specialist agents or team composition?
- [ ] Does Codex support any equivalent concept?
- [ ] Do other tools (Cline, Aider, Windsurf) have team/subagent concepts?

### Architecture Patterns
- [ ] What patterns exist for defining specialist roles (config files, inline, project-level)?
- [ ] How are team members triggered — manually, on file change, on commit, on tool use?
- [ ] Can team members run in parallel or must they be sequential?
- [ ] How do team members share context (full conversation, scoped context, file-based)?
- [ ] What isolation model do team members use (same session, forked context, independent)?

### Aigon Integration
- [ ] Could Aigon define a generic team composition format that maps to each agent's native system?
- [ ] Should team definitions live in feature specs, project config (`.aigon/config.json`), or both?
- [ ] How would teams interact with Aigon's existing arena mode (teams within competitors)?
- [ ] Should Aigon provide a library of pre-built specialist templates (docs updater, test writer, etc.)?
- [ ] How would team member output be coordinated — sequential pipeline, event-driven, or manual?

### Reactive vs Proactive
- [ ] What mechanisms exist for making agents reactive to code changes (file watchers, git hooks, CI triggers)?
- [ ] Is reactive behaviour better handled by agent teams or by Aigon's existing hook system?
- [ ] Could Aigon's hook system (`docs/aigon-hooks.md`) be extended to trigger specialist agents?

## Scope

### In Scope
- Survey of team/subagent support across all major coding agents
- Claude Code Agent Teams deep dive (as the reference implementation)
- Generic team composition format design considerations
- Integration points with Aigon's existing architecture (arena, hooks, profiles)
- Reactive agent patterns (triggered by code changes)

### Out of Scope
- Implementation of team support in Aigon
- Changes to arena mode architecture
- Building specific specialist agents (docs updater, test writer, etc.)
- CI/CD integration for reactive triggers

## Inspiration
- Claude Code Agent Teams: https://code.claude.com/docs/en/agent-teams
- Aigon's existing arena mode (competing agents on same feature)
- Aigon's hook system as a potential trigger mechanism
