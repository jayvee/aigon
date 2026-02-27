# Feature: Arena Adopt Best-of-Losers (`feature-done --adopt`)

## Summary

After selecting an arena winner with `aigon feature-done <ID> <winner>`, the `--adopt` flag tells the evaluating agent to diff the losing implementations against the winner and selectively bring in valuable additions -- extra tests, error handling, documentation, edge case coverage -- as a follow-up commit. This is not a git merge; it is a curated, agent-reviewed adoption of the best parts from losing implementations into the winning codebase.

## Motivation

Arena mode produces multiple independent implementations of the same feature. When a winner is selected, the losing implementations are typically discarded (or archived to `logs/alternatives/`). But losers often contain valuable work that the winner lacks: additional test cases, defensive error handling, documentation, or edge case coverage. Today, recovering these improvements requires manual code archaeology across worktree branches. The `--adopt` flag automates the discovery and selective integration of these improvements, maximizing the return on the parallel implementation investment.

## User Stories

- [ ] As an arena coordinator, after picking a winner I can bring in extra test cases from a losing implementation so the final result has the best test coverage from all agents.
- [ ] As an arena coordinator, I can adopt documentation improvements from a losing agent without taking their structural code changes.
- [ ] As an arena coordinator, the adoption is verified (tests pass) before committing, so I know the combined result is sound.
- [ ] As an arena coordinator, I can adopt from one specific loser (`--adopt cc`) or from multiple (`--adopt cc cu`), controlling exactly which implementations are mined for improvements.
- [ ] As an arena coordinator, I can see a summary of what was adopted from each agent so I have a clear audit trail of where improvements came from.

## Usage

```bash
# Merge winner cx, then adopt best improvements from cc
aigon feature-done 12 cx --adopt cc

# Merge winner cx, then adopt best improvements from cc and cu
aigon feature-done 12 cx --adopt cc cu

# Existing behavior is unchanged when --adopt is omitted
aigon feature-done 12 cx
```

## Acceptance Criteria

### Core Flow

- [ ] `aigon feature-done <ID> <winner> --adopt <agent> [agent...]` merges the winner as normal (existing behavior), then runs the adoption pass for each specified agent
- [ ] The winner merge completes fully before any adoption begins (adoption is a follow-up step, not interleaved with the merge)
- [ ] When `--adopt` is not specified, `feature-done` behaves identically to today (no regression)

### Diff and Discovery

- [ ] For each adopted agent, the system computes the diff between the adopted agent's branch and the winner's branch (post-merge on main)
- [ ] The diff is categorized into addition types: new test cases, error handling improvements, documentation additions, edge case coverage, and other additive changes
- [ ] Structural or architectural changes that conflict with the winner's design are identified and excluded from consideration
- [ ] The evaluating agent is presented with a clear summary of unique additions per adopted agent, grouped by category

### Selective Application

- [ ] The evaluating agent (Claude or human) reviews each discovered addition and decides whether to include it
- [ ] Adopted changes are adapted to work with the winner's code structure -- file paths, import paths, function signatures, and naming conventions are adjusted as needed
- [ ] If a change cannot be cleanly adapted (e.g., depends on architecture the winner didn't use), it is skipped with a note in the adoption summary

### Verification

- [ ] After all adoptions are applied, the full test suite runs (`cd app && npm test`)
- [ ] If tests fail after adoption, the evaluating agent diagnoses and fixes the issue or reverts the problematic adoption
- [ ] Tests must pass before the adoption commit is created

### Commit and Cleanup

- [ ] A follow-up commit is created: `chore: adopt improvements from <agent(s)> into feature <ID>`
- [ ] The commit message body lists what was adopted from each agent (test cases, error handling, docs, etc.)
- [ ] Adopted agents' worktrees and local branches are cleaned up (same as `feature-cleanup` behavior for those agents)
- [ ] Non-adopted losing agents are left for the user to clean up via `feature-cleanup` as usual

### Output and Reporting

- [ ] The adoption summary is printed to the console, showing per-agent: what was reviewed, what was adopted, what was skipped, and why
- [ ] The adoption summary is appended to the winning agent's implementation log in `logs/selected/`

## Technical Approach

### Step 1: Extend the `feature-done` Command

Add `--adopt` flag parsing to the existing `feature-done` command (`.claude/commands/aigon/feature-done.md`). The flag accepts one or more agent codes as arguments. The adoption pass runs after the existing merge and spec-move steps complete.

### Step 2: Diff Computation

For each adopted agent, compute a meaningful diff:

```bash
# After winner is merged to main, diff each adopted agent's branch against main
git diff main...feature-<ID>-<adopted-agent>-<name>
```

The raw diff is then analyzed by the evaluating agent to categorize changes:

1. **New test files or test cases** -- any additions to `*.test.js`, `*.spec.js`, or test directories
2. **Error handling** -- try/catch blocks, validation checks, error messages not present in the winner
3. **Documentation** -- JSDoc comments, inline comments, README additions
4. **Edge case coverage** -- guard clauses, boundary checks, null/undefined handling
5. **Other additive changes** -- utility functions, constants, configuration that complement the winner

### Step 3: Agent-Reviewed Adoption

The evaluating agent processes each category:

1. **Present** the additions to the evaluating agent with context (file, surrounding code, purpose)
2. **Evaluate** each addition against the winner's code: does it add value? Is it compatible?
3. **Adapt** accepted additions to fit the winner's code structure:
   - Adjust file paths if the winner organized code differently
   - Update import paths to match the winner's module structure
   - Rename variables/functions to match the winner's naming conventions
   - Merge test cases into the winner's existing test files rather than creating parallel test files
4. **Apply** the adapted changes to the working tree

### Step 4: Verification

```bash
cd app && npm test
```

If tests fail:
- The agent diagnoses the failure
- If it is caused by an adopted change, the agent either fixes the adaptation or reverts that specific adoption
- Re-run tests until green
- If no adopted changes can be made to pass, the adoption is abandoned with a summary of what was attempted

### Step 5: Commit

```bash
git add -A
git commit -m "chore: adopt improvements from cc into feature 12

Adopted from cc:
- 3 additional test cases for edge cases in parser
- Error handling for empty input in forecaster
- JSDoc documentation for public API functions

Skipped:
- Alternative caching strategy (architectural difference)
"
```

### Step 6: Cleanup

Clean up the adopted agent's worktree and local branch, following the same logic as `feature-cleanup`:

```bash
git worktree remove .claude/worktrees/feature-<ID>-<agent>-<name>
git branch -D feature-<ID>-<agent>-<name>
```

The adopted agent's branch is pushed to origin before removal if the user requested `--push` preservation (same as `feature-cleanup --push`).

### Integration with Existing Commands

The `--adopt` flag is additive to the existing `feature-done` flow. The command structure becomes:

```
aigon feature-done <ID> <winner> [--adopt <agent1> [agent2] ...]
```

Internally, the execution order is:

1. Run existing `feature-done` logic (merge winner, move spec, organize logs)
2. For each `--adopt` agent (in order specified):
   a. Compute diff
   b. Present and review additions
   c. Apply accepted changes
   d. Run tests
   e. Commit
   f. Cleanup adopted agent's worktree/branch

### Error Handling

- If an adopted agent's branch does not exist, print a warning and skip that agent
- If the diff is empty (adopted agent's code is identical to winner), print a note and skip
- If all adoptions are skipped (nothing valuable found), no commit is created
- If tests fail and cannot be fixed, revert all adoptions for the current agent and continue to the next adopted agent

## Dependencies

- Existing `feature-done` command (`.claude/commands/aigon/feature-done.md`) -- this feature extends it
- Existing `feature-cleanup` command (`.claude/commands/aigon/feature-cleanup.md`) -- reuses cleanup logic
- Git worktree branches must still exist at adoption time (adoption runs before cleanup)
- The evaluating agent must be capable of reading diffs, understanding code context, and making selective edits

## Out of Scope

- **Automatic conflict resolution** -- the evaluating agent reviews manually; there is no automated merge tool
- **Adopting architectural changes** -- only additive improvements are considered, not structural redesigns
- **Modifying existing `feature-done` behavior** when `--adopt` is not specified -- zero regression risk
- **Adopting from agents not specified in `--adopt`** -- the user explicitly chooses which losers to mine
- **Interactive UI for adoption review** -- the agent reviews in its own session; no TUI or web UI
- **Cross-feature adoption** -- adopting from a different feature's arena is not supported
- **Automatic scoring of adoption candidates** -- the agent uses judgment, not a scoring algorithm

## Open Questions

- Should the adoption commit be a single commit covering all adopted agents, or one commit per adopted agent? A single commit is simpler but loses per-agent attribution in git history. One commit per agent provides clearer provenance. (Leaning: one commit per agent.)
- Should `--adopt all` be supported as shorthand for adopting from all non-winner agents? This is convenient but may be noisy for large arenas. (Leaning: yes, support `--adopt all` as a convenience.)
- Should the adoption summary be written to a separate file (e.g., `logs/adoptions/feature-<ID>-adoption.md`) or appended to the winning log? (Leaning: append to winning log to keep all feature context in one place.)
- How should the feature interact with `feature-cleanup`? If `--adopt cc` is used, should `feature-cleanup` skip `cc` automatically since it was already cleaned up? (Leaning: yes, track which agents were adopted and skip them in cleanup.)

## Related

- Current `feature-done` command: `.claude/commands/aigon/feature-done.md`
- Current `feature-cleanup` command: `.claude/commands/aigon/feature-cleanup.md`
- Arena workflow documentation: `docs/development_workflow.md`
- Aigon hooks (pre-feature-done test gate): `docs/aigon-hooks.md`
- Feature 10 spec (arena scripts): `docs/specs/features/05-done/feature-10-arena-scripts.md`
