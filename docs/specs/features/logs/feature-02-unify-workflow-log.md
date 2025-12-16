# Implementation Log: Feature 02 - unify-workflow

## Plan

Incremental approach chosen (Option 2):
- Phase 1: Core CLI changes
- Phase 2: Template updates
- Phase 3: Agent config updates
- Phase 4: Documentation (README, workflow docs, feature specs)
- Phase 5: Verification

## Progress

### Phase 1: CLI Refactor ✅ (Commit 67d228e)

**New Commands:**
- `feature-setup <ID> [agents...]` - Unified setup for solo/arena modes
  - Solo: `feature-setup 55` (creates branch)
  - Arena: `feature-setup 55 cc gg cx` (creates worktrees)
- `feature-cleanup <ID> [--push]` - Renamed from `cleanup`

**Updated Commands:**
- `feature-implement` - Auto-detects mode (solo/arena) based on location
- `feature-eval` - Creates appropriate templates for both modes
- `feature-prioritise` - Updated to show new command structure
- `feature-done` - Mode detection unchanged, already worked

**Removed:**
- `bakeoff-setup` - Replaced by `feature-setup` with agents
- `bakeoff-implement` - Functionality merged into `feature-implement`
- `bakeoff-cleanup` alias - Now `feature-cleanup`

**Environment Variables:**
- Added `AIGON_MODE` ("solo" | "arena")
- Updated all hook contexts to include mode

**Hook Changes:**
- `pre/post-bakeoff-setup` → `pre/post-feature-setup`
- `pre/post-bakeoff-cleanup` → `pre/post-feature-cleanup`

### Phase 2: Template Updates ✅ (Commit 192f6dc)

**Deleted:**
- `bakeoff-cleanup.md`
- `bakeoff-implement.md`
- `bakeoff-setup.md`

**Created:**
- `feature-setup.md` - Documents both solo and arena modes
- `feature-cleanup.md` - Cleanup for both modes

**Updated:**
- `feature-implement.md` - Works in both modes, added pwd verification
- `feature-eval.md` - Code review (solo) or comparison (arena)
- `feature-done.md` - Arena terminology, cleanup instructions
- `feature-prioritise.md` - New command examples

### Phase 3: Agent Configs ✅ (Commit 4557efc)

Updated command lists in:
- `cc.json` (Claude)
- `cx.json` (Codex)
- `gg.json` (Gemini)

Changes:
- Removed: `bakeoff-setup`, `bakeoff-implement`, `bakeoff-cleanup`
- Added: `feature-setup`, `feature-cleanup`

### Phase 4: Documentation (NOT STARTED)

Remaining work:
- Update `README.md` with new unified structure
- Update `docs/development_workflow.md`
- Update inbox feature specs referencing bakeoff
- These are not critical for functionality

### Phase 5: Verification (NOT STARTED)

To do:
- Search for remaining "bakeoff" references
- Verify hooks work with new names
- Test commands in both modes

## Decisions

### Mode Detection Strategy: Hybrid Approach
- **Primary**: Git state (worktrees, branch patterns) - fast and resilient
- **Secondary**: Could add spec metadata later if needed
- Decision: Start with git state detection, it's sufficient

### Command Naming: feature-setup vs feature-start
- Chose "setup" over "start" to avoid implying implementation begins
- "setup" clearly indicates preparation of workspace
- Aligns with existing `bakeoff-setup` → easier migration

### Breaking Changes: No Backwards Compatibility
- Removed old `bakeoff-*` commands completely
- No aliases maintained
- Clean break, version 2.0.0
- Users must update hooks

### Incremental Commits
- Phase 1: CLI (functional but templates broken)
- Phase 2: Templates (now functional)
- Phase 3: Agent configs (agents can now use commands)
- Stopped here to let user test before tackling docs

### Solo Mode Code Review Feature
- `feature-eval` now useful in solo mode
- Creates checklist template for code review
- Enables getting second opinion from different agent
- Good addition to the workflow

## Key Implementation Notes

1. **Mode detection** in commands uses directory name matching and worktree detection
2. **Environment variable** `AIGON_MODE` added for hooks to detect mode
3. **Working directory verification** added to prevent git errors (especially for Codex)
4. **Port configuration** preserved from bakeoff (cc=3001, gg=3002, cx=3003)
5. **Template placeholders** work across all agents ({{ARG1_SYNTAX}}, {{CMD_PREFIX}})

## Testing Required

Before continuing to documentation:
1. Test `feature-setup 55` (solo mode)
2. Test `feature-setup 55 cc gg` (arena mode)
3. Verify generated commands work in `.claude/commands/`
4. Check agent config generation with `aigon install-agent cc`
5. Verify hooks fire with correct environment variables

## Bugs Found During Testing

### Arena Log File Merge Conflict (Fixed in 3c20688)

**Issue**: When merging the winning arena branch, merge conflicts occurred in log files.

**Root Cause**: `feature-setup` in arena mode created log files in the main repo's `docs/specs/features/logs/` directory. When agents worked in worktrees and filled in these logs, merging created conflicts between:
- Main's empty template
- Feature branch's filled log

**Fix**: Moved log file creation inside each worktree after it's created. Log files now write to `worktreePath/docs/specs/features/logs/` instead of main repo, so they only exist on feature branches and merge cleanly.

**Code changed**: `aigon-cli.js:816-825` - log creation moved inside worktree setup try block

## Next Steps

After testing and approval:
1. Update README.md with new command structure and examples
2. Update docs/development_workflow.md
3. Update inbox feature specs
4. Search for remaining "bakeoff" references
5. Update version to 2.0.0
6. Create migration guide for existing users
