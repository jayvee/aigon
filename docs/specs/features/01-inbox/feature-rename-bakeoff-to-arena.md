# Purpose
Unify feature workflow commands and rename "bakeoff" terminology to "arena" for better alignment with AI dev workflow industry standards.

## Rationale

### Industry Alignment
The term "arena" is well-established in the AI/ML community for agent comparison and competition:
- Berkeley/LM Arena's "Agent Arena" - Interactive sandbox for comparing agentic workflows
- Microsoft's "Windows Agent Arena" - Platform for testing agents in parallel
- Masa's "AI Agent Arena" - Competitive platform for AI agents

"Arena" is more recognizable and professional than "bakeoff" in this context.

### Simplified Command Structure
Currently aigon has two parallel command structures:
- Solo mode: `feature-*` commands
- Multi-agent mode: `bakeoff-*` commands

This creates unnecessary complexity when it's really just two modes of the same workflow. The new structure uses a single set of commands with mode determined by parameters.

## New Command Structure

### Current Commands (Before)
```bash
# Solo mode
aigon feature-create <name>
aigon feature-prioritise <name>
aigon feature-implement <ID>    # Solo implementation
aigon feature-done <ID>

# Multi-agent mode (separate commands)
aigon bakeoff-setup <ID> <agents...>
aigon bakeoff-implement <ID>
aigon bakeoff-cleanup <ID>
aigon feature-eval <ID>          # Only for multi-agent
aigon feature-done <ID> <agent>
```

### New Unified Commands (After)
```bash
aigon feature-create <name>
aigon feature-prioritise <name>
aigon feature-setup <ID> [agents...]
  # No agents → solo mode: creates branch feature-ID-desc
  # With agents → arena mode: creates worktrees feature-ID-agent-desc

aigon feature-implement <ID>
  # Solo: implement in main branch
  # Arena: implement in current worktree

aigon feature-eval <ID>
  # Solo: optional code review (can use different agent)
  # Arena: required comparison of all implementations

aigon feature-done <ID> [agent]
  # Solo: merges feature-ID-desc
  # Arena: merges feature-ID-agent-desc (agent required)

aigon feature-cleanup <ID>
  # Removes all worktrees and branches for a feature
```

### Benefits
1. **Single workflow**: All commands start with `feature-`
2. **Mode inferred from usage**: Parameters determine solo vs arena mode
3. **Fewer commands**: 7 instead of 10
4. **Clearer**: "setup" vs "start" - setup doesn't imply implementation
5. **feature-eval useful in both modes**: Get code review even in solo mode

## Mode Detection

Commands detect whether a feature is in solo or arena mode using a hybrid approach:

### Primary: Git State (Fast & Resilient)
```javascript
// Check for worktrees
const hasWorktrees = git worktree list shows feature-ID-*-*

// Check branch pattern
const branchName = current or target branch
const hasAgentInBranch = matches feature-ID-agent-desc pattern

const mode = hasWorktrees || hasAgentInBranch ? 'arena' : 'solo'
```

### Secondary: Spec Metadata (Validation)
Add frontmatter to feature spec when running `feature-setup`:
```markdown
---
id: 55
name: dark-mode
status: in-progress
mode: arena  # or "solo"
agents: [cc, gg, cx]  # only if arena mode
---
```

Commands read spec metadata as fallback/validation if git state is ambiguous.

## Scope of Changes

### Terminology Changes (229 occurrences)
- "bakeoff" → "arena" (everywhere)
- "multi-agent bakeoff" → "multi-agent arena" or "arena mode"
- "bakeoff worktree" → "arena worktree"

### Command Renames
- ❌ `bakeoff-setup` → ✅ `feature-setup <ID> <agents...>`
- ❌ `bakeoff-implement` → ✅ `feature-implement <ID>` (unified)
- ❌ `bakeoff-cleanup` → ✅ `feature-cleanup <ID>`

### Hook Names
- `pre-bakeoff-setup` → `pre-feature-setup` (when in arena mode)
- `post-bakeoff-setup` → `post-feature-setup` (when in arena mode)
- `pre-bakeoff-cleanup` → `pre-feature-cleanup`
- `post-bakeoff-cleanup` → `post-feature-cleanup`

Note: Hooks are now workflow-based, not mode-based. Mode can be detected via environment variables.

### Environment Variables (Hooks)
- `AIGON_BAKEOFF_MODE` → `AIGON_MODE` (values: "solo" | "arena")
- Keep existing: `AIGON_FEATURE_ID`, `AIGON_FEATURE_NAME`, `AIGON_AGENTS`, `AIGON_AGENT`, `AIGON_WORKTREE_PATH`

## Files Affected (30+ files)

### Command Files - DELETE (9 files)
- `.claude/commands/aigon-bakeoff-*.md` (3 files) - DELETE
- `.gemini/commands/aigon/bakeoff-*.toml` (3 files) - DELETE
- `templates/generic/commands/bakeoff-*.md` (3 files) - DELETE

### Command Files - CREATE/UPDATE
- `templates/generic/commands/feature-setup.md` - CREATE (replaces bakeoff-setup)
- `templates/generic/commands/feature-implement.md` - UPDATE (handle both modes)
- `templates/generic/commands/feature-eval.md` - UPDATE (handle both modes)
- `templates/generic/commands/feature-cleanup.md` - CREATE (replaces bakeoff-cleanup)
- `templates/generic/commands/feature-done.md` - UPDATE (clarify mode detection)

### Core Implementation
- `aigon-cli.js` - Major refactor:
  - Remove `bakeoff-setup`, `bakeoff-implement`, `bakeoff-cleanup` commands
  - Update `feature-setup` to handle both solo and arena modes
  - Update `feature-implement` to work in both modes
  - Update `feature-eval` to work in both modes
  - Update `feature-done` to detect mode
  - Add `feature-cleanup` command
  - Update hook names and environment variables
  - Update help text

### Templates & Configuration (10 files)
- `templates/generic/commands/help.md` - Update command list, remove bakeoff section
- `templates/generic/commands/feature-prioritise.md` - Update references
- `templates/generic/skill.md` - Update tool names and descriptions
- `templates/generic/docs/agent.md` - Update workflow documentation
- `templates/docs/development_workflow.md` - Full workflow update
- `templates/agents/cc.json` - Update commands array
- `templates/agents/cx.json` - Update commands array
- `templates/agents/gg.json` - Update commands array

### Documentation (2 files)
- `README.md` - Complete rewrite of:
  - Workflow section (solo vs arena)
  - Command reference
  - Hook examples
  - Environment variables
  - Examples throughout
- `docs/development_workflow.md` - Update all workflow descriptions

### Feature Specs (4 files)
- `docs/specs/features/05-done/feature-01-support-hooks.md` - Update hook names and examples
- `docs/specs/features/01-inbox/feature-change-banner-in-bakeoff.md` - Rename to "arena", update content
- `docs/specs/features/01-inbox/feature-subdomain-configuration-for-bakeoff-mode.md` - Rename to "arena", update content
- `docs/specs/features/01-inbox/feature-add-sample-chat-for-workflow.md` - Update sample chat

## Implementation Strategy

### Phase 1: Core CLI Changes
1. Update `aigon-cli.js`:
   - Implement unified `feature-setup` (solo + arena modes)
   - Update `feature-implement` to handle both modes
   - Update `feature-eval` to handle both modes
   - Implement `feature-cleanup`
   - Update `feature-done` mode detection
   - Remove old `bakeoff-*` commands
   - Update hooks and environment variables

### Phase 2: Template Updates
2. Delete old bakeoff command templates
3. Create new `feature-setup.md` and `feature-cleanup.md`
4. Update `feature-implement.md`, `feature-eval.md`, `feature-done.md`
5. Update all other templates with new terminology and commands

### Phase 3: Configuration Updates
6. Update agent configuration files (cc.json, cx.json, gg.json)
7. Update help.md and skill.md templates

### Phase 4: Documentation
8. Update README.md with new command structure and examples
9. Update docs/development_workflow.md
10. Update feature specs

### Phase 5: Verification
11. Search for any remaining "bakeoff" references
12. Verify all hook examples use new names
13. Test command help text shows correct structure

## Breaking Changes

### No Backwards Compatibility
- Old `bakeoff-*` commands will be completely removed
- Hooks with `bakeoff` in the name will no longer trigger
- Environment variables like `AIGON_BAKEOFF_MODE` will not be set
- Users must update their hooks configuration

### Migration for Existing Users
Users with existing hooks must update:
```bash
# Old hooks (will stop working)
pre-bakeoff-setup
post-bakeoff-setup
pre-bakeoff-cleanup

# New hooks
pre-feature-setup    # Triggered for both solo and arena modes
post-feature-setup   # Triggered for both solo and arena modes
pre-feature-cleanup
post-feature-cleanup

# Detect mode in hooks via:
if [ "$AIGON_MODE" = "arena" ]; then
  # arena-specific logic
fi
```

## New Feature: feature-eval in Solo Mode

Previously `feature-eval` was only useful for arena mode. Now it serves both:

### Solo Mode Usage
```bash
# Implement with Claude
aigon feature-setup 55
/aigon feature-implement 55
# ... implementation complete ...

# Get code review from Gemini
gg feature-eval 55
# Creates evaluation file with code review

# Merge if satisfied
aigon feature-done 55
```

### What feature-eval Checks (Solo Mode)
1. Spec compliance - Does implementation match requirements?
2. Code quality - Best practices, patterns, maintainability
3. Testing - Are there tests? Do they pass?
4. Documentation - Comments, README updates
5. Security - Any obvious vulnerabilities?

The evaluation file documents the review, useful for:
- Getting feedback before merging
- Historical record of quality checks
- Learning from AI code reviews

## Testing Checklist

After implementation, verify:
- [ ] `aigon feature-setup 55` creates solo mode (branch only)
- [ ] `aigon feature-setup 55 cc gg cx` creates arena mode (worktrees)
- [ ] `aigon feature-implement 55` works in both modes
- [ ] `aigon feature-eval 55` works in both modes
- [ ] `aigon feature-done 55` works in solo mode
- [ ] `aigon feature-done 55 cc` works in arena mode
- [ ] `aigon feature-cleanup 55` removes all worktrees and branches
- [ ] Help text shows correct unified command structure
- [ ] Hooks fire with correct names and environment variables
- [ ] No "bakeoff" references remain in active code/docs
- [ ] Agent JSON configs have correct command list
- [ ] README examples work as documented

## Notes
- Git branch names (e.g., `fix-bakeoff-setup`) remain unchanged as historical artifacts
- This is a breaking change - version bump to 2.0.0 when released
- Users with existing hooks must update their configuration
- Clearer separation: "setup" = prepare workspace, "implement" = do the work
