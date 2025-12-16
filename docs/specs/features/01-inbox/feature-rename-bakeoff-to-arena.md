# Purpose
Rename "bakeoff" terminology to "arena" throughout the codebase for better alignment with AI dev workflow industry standards.

## Rationale
The term "arena" is well-established in the AI/ML community for agent comparison and competition:
- Berkeley/LM Arena's "Agent Arena" - Interactive sandbox for comparing agentic workflows
- Microsoft's "Windows Agent Arena" - Platform for testing agents in parallel
- Masa's "AI Agent Arena" - Competitive platform for AI agents
- OpenAI uses "Swarm" for similar concepts

"Arena" is more recognizable and professional than "bakeoff" in this context.

## Scope
Rename all 229 occurrences across:
- Command names: `bakeoff-setup` → `arena-setup`, `bakeoff-implement` → `arena-implement`, `bakeoff-cleanup` → `arena-cleanup`
- Hook names: `pre-bakeoff-setup` → `pre-arena-setup`, `post-bakeoff-setup` → `post-arena-setup`, etc.
- Variable names: `aigon_bakeoff_*` → `aigon_arena_*`
- Documentation and examples
- Terminology: "multi-agent bakeoff" → "multi-agent arena"

## Files Affected (30+ files)

### Command Files (9 files)
- `.claude/commands/aigon-bakeoff-*.md` → `aigon-arena-*.md` (3 files)
- `.gemini/commands/aigon/bakeoff-*.toml` → `arena-*.toml` (3 files)
- `templates/generic/commands/bakeoff-*.md` → `arena-*.md` (3 files)

### Core Implementation
- `aigon-cli.js` - Command definitions, hooks, help text, variables

### Templates & Configuration (10 files)
- `templates/generic/commands/help.md`
- `templates/generic/commands/feature-implement.md`
- `templates/generic/commands/feature-done.md`
- `templates/generic/commands/feature-prioritise.md`
- `templates/generic/skill.md`
- `templates/generic/docs/agent.md`
- `templates/docs/development_workflow.md`
- `templates/agents/cc.json`
- `templates/agents/cx.json`
- `templates/agents/gg.json`

### Documentation (2 files)
- `README.md`
- `docs/development_workflow.md`

### Feature Specs (4 files)
- `docs/specs/features/05-done/feature-01-support-hooks.md`
- `docs/specs/features/01-inbox/feature-change-banner-in-bakeoff.md`
- `docs/specs/features/01-inbox/feature-subdomain-configuration-for-bakeoff-mode.md`
- `docs/specs/features/01-inbox/feature-add-sample-chat-for-workflow.md`

## Implementation Strategy
1. Rename files using `git mv` to preserve history
2. Update aigon-cli.js (most complex changes)
3. Update all templates and configuration files
4. Update documentation
5. Update feature specs
6. Verify no remaining "bakeoff" references

## Notes
- Clean rename with no backwards compatibility (no aliases)
- Git branch names (e.g., `fix-bakeoff-setup`) remain unchanged as historical artifacts
- Affects hook environment variables users may have configured
