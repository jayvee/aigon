# Implementation Log: Feature 07 - backlog-visualisation

## Plan

Create a unified `aigon board` command that:
1. Shows Kanban board view by default (visual overview)
2. Supports `--list` flag for detailed list view (replaces `feature-list`)
3. Works for both features and research topics
4. Supports filtering flags: `--features`, `--research`, `--active`, `--all`, `--inbox`, `--backlog`, `--done`
5. Shows work mode indicators (solo/arena/worktree)
6. Remove `feature-list` command entirely

## Progress

### Research Phase
- Investigated backlog.md and other CLI Kanban tools
- Found industry pattern: separate `board` (visual) and `list` (detailed) commands
- User decided to unify both views into single `aigon board` command with `--list` flag

### Implementation Phase
1. **Added helper functions** (lines 1242-1534):
   - `collectBoardItems()` - Scans directories and collects items
   - `getWorktreeInfo()` - Detects arena/solo-wt modes
   - `getCurrentBranch()` - Identifies active branch
   - `displayBoardKanbanView()` - Renders Kanban board with box-drawing characters
   - `displayKanbanSection()` - Renders one section (features or research)
   - `displayBoardListView()` - Renders detailed list
   - `displayListSection()` - Renders list for one section

2. **Replaced `feature-list`** with unified `board` command (line 2730):
   - Parses flags: `--list`, `--features`, `--research`, filtering flags
   - Routes to appropriate display function
   - Default: both features and research in Kanban view

3. **Updated COMMAND_ARGS** (line 1103):
   - Removed `'feature-list': ''`
   - Added `'board': '[--list] [--features] [--research] [--active] [--all] [--inbox] [--backlog] [--done]'`

4. **Updated help text** (lines 3750-3761):
   - Added "Visualization" section
   - Documented board command and flags

5. **Updated README.md**:
   - Added "Visualizing Work" section with Kanban and list view examples
   - Updated CLI Reference table (removed feature-list, added board)
   - Updated all slash command tables across 4 agents
   - Added indicators documentation (`*`, `[2]`, `[wt]`)

### Testing
- Verified `aigon board` shows Kanban view
- Verified `aigon board --list` shows detailed list
- Verified `aigon board --features --list` filtering works
- Confirmed `feature-list` command no longer exists
- Tested help text displays correctly

## Decisions

### Design Decisions

1. **Unified command over separate commands**
   - Decision: Single `aigon board` with `--list` flag vs separate `board` and `list` commands
   - Rationale: Cleaner CLI, both views show the same data in different formats
   - Alternative considered: Separate commands like backlog.md (`board view`, `tasks`)

2. **Box-drawing characters for Kanban**
   - Decision: Use Unicode box-drawing characters (┌─┐│├┤└┘)
   - Rationale: Widely supported, clean visual separation
   - Trade-off: Requires Unicode terminal support (standard in modern terminals)

3. **Work mode indicators**
   - Decision: Show `[2]` for arena count, `[wt]` for solo-wt, `*` for current branch
   - Rationale: Compact, fits in Kanban column width, clear meaning
   - User feedback: Requested this specifically to show arena mode in board view

4. **Column width**
   - Decision: Fixed 14-character columns
   - Rationale: Fits standard terminals, predictable layout
   - Trade-off: Names get truncated (acceptable for quick overview)

5. **Default filters**
   - Decision: Show everything except done by default
   - Rationale: Matches existing `feature-list` behavior, focuses on active work
   - Override: Use `--all` to include done items

6. **Research folder mapping**
   - Decision: Research has `04-done` instead of `05-done` (different from features)
   - Rationale: Follows existing PATHS.research.folders structure
   - Implementation: Conditional folder mapping in helper functions

### Technical Decisions

1. **Function organization**
   - Decision: Helper functions before COMMANDS object
   - Rationale: Keeps command implementation clean, reusable logic
   - Location: Lines 1242-1534 (before `// --- Commands ---`)

2. **Worktree detection**
   - Decision: Parse `git worktree list` output with regex
   - Rationale: Reuses existing pattern from `feature-list`
   - Supports: Both feature and research worktrees

3. **Filtering logic**
   - Decision: Shared filtering logic in both Kanban and list views
   - Rationale: DRY principle, consistent behavior
   - Implementation: Same folder filtering code in both display functions

## Issues Encountered

None - implementation went smoothly.

## Post-Implementation Improvements

### User Feedback Round 1: Truncation and Slash Commands

**Issue**: Column width of 14 chars was too narrow, most names truncated

**Solution 1**: Increased fixed width to 20 chars
- Commit: "feat: improve board display and add slash commands"
- Result: Names like "parallel-features" and "plugin-distribution" now show fully

**Solution 2**: Added slash command templates
- Created `templates/generic/commands/board.md`
- Updated all agent configs (cc, gg, cu, cx) to include `board` command
- Generated slash commands: `/aigon:board`, `/aigon-board`, `/prompts:aigon-board`
- Removed old `feature-list.md` template

### User Feedback Round 2: Dynamic Layout

**Issue**: Fixed width doesn't use available terminal space, empty columns waste space

**Solution 1**: Dynamic column width (commit: 629ad30)
- Detects terminal width using `process.stdout.columns`
- Calculates optimal column width: `(terminalWidth - borders) / numColumns`
- Enforces bounds: min 12 chars, max 30 chars
- Result: Columns expand to use available space

**Solution 2**: Auto-collapse empty columns
- Filters out columns with zero items before rendering
- Only shows columns that have content
- Result: Compact board, focuses on relevant stages
- Example: If Backlog and Evaluation are empty, only shows Inbox, In Progress, Done

**Impact**: Board is now highly readable and efficient:
- 2 columns with items → ~30 chars each (nearly full names)
- 5 columns with items → ~20 chars each (still readable)
- Empty stages don't clutter the display

## Next Steps

None - feature complete with user-requested enhancements.
