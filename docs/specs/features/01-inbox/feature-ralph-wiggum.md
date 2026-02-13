# Feature: ralph-wiggum

## Summary

The Ralph Wiggum technique enables autonomous, iterative feature implementation where an agent continuously attempts to implement a feature, runs validation checks, and automatically retries until all acceptance criteria are satisfied or a maximum iteration limit is reached. Named after the character known for cheerful persistence, this technique transforms the current "implement once and stop" workflow into a self-healing loop that pursues completion until success.

## User Stories

- [ ] As a developer, I want an agent to automatically retry implementation when tests fail so I don't have to manually restart the process
- [ ] As a developer, I want the agent to validate against acceptance criteria on each iteration so I can trust the feature is complete
- [ ] As a developer, I want a maximum iteration limit to prevent infinite loops when a feature can't be automatically fixed
- [ ] As a developer, I want detailed logs of each iteration's attempts and failures so I can understand what was tried
- [ ] As a developer, I want to be able to intervene during the loop if needed without losing progress
- [ ] As a team lead, I want to use this technique in both solo and arena modes for consistent autonomous implementation

## Acceptance Criteria

- [ ] New command flag `--loop` or `--ralph` added to `feature-implement` to enable autonomous iteration mode
- [ ] Agent automatically validates implementation against acceptance criteria after each attempt
- [ ] Agent runs validation checks (tests, build, linting) and checks results after each iteration
- [ ] Agent automatically fixes issues and retries when validation fails
- [ ] Maximum iteration limit (default: 5, configurable) prevents infinite loops
- [ ] Each iteration's attempt, validation results, and fixes are logged to the implementation log
- [ ] Loop terminates successfully when all acceptance criteria are satisfied
- [ ] Loop terminates with failure report after max iterations if criteria remain unsatisfied
- [ ] User can interrupt the loop at any time and resume later
- [ ] Works in solo mode (branch), solo worktree mode, and arena mode
- [ ] Integration with existing task tracking system to update task status during loop
- [ ] Configuration option to define custom validation scripts per project profile

## Technical Approach

### Core Loop Architecture

Add a `--loop` flag to `feature-implement` command that wraps the standard implementation workflow in an autonomous iteration loop:

```javascript
async function featureImplementLoop(featureId, options = {}) {
  const maxIterations = options.maxIterations || 5;
  const validationScript = options.validationScript || getDefaultValidation();

  for (let iteration = 1; iteration <= maxIterations; iteration++) {
    logIteration(featureId, iteration);

    // 1. Implement (or fix issues from previous iteration)
    const implementation = await runImplementation(featureId, iteration);

    // 2. Run validation checks
    const validation = await runValidation(featureId, validationScript);

    // 3. Check acceptance criteria
    const criteriaCheck = await checkAcceptanceCriteria(featureId);

    // 4. Update iteration log
    await logIterationResults(featureId, iteration, {
      implementation,
      validation,
      criteriaCheck
    });

    // 5. Success condition: all criteria met and validation passed
    if (criteriaCheck.allMet && validation.passed) {
      console.log(`✅ Success on iteration ${iteration}!`);
      return { success: true, iterations: iteration };
    }

    // 6. Prepare feedback for next iteration
    const feedback = generateFeedback(validation, criteriaCheck);
    await prepareNextIteration(featureId, feedback);
  }

  // Max iterations reached without success
  return {
    success: false,
    iterations: maxIterations,
    remainingIssues: await summarizeRemainingIssues(featureId)
  };
}
```

### Validation System

**Built-in Validation Checks:**
1. **Test execution** - Run test suite and check for failures
2. **Build verification** - Ensure code compiles/builds successfully
3. **Linting** - Run linters and check for violations
4. **Type checking** - Run type checker if applicable (TypeScript, mypy, etc.)
5. **Git status** - Ensure all changes are committed

**Profile-Specific Validation:**
- Web profile: `npm test`, `npm run build`, `npm run lint`
- API profile: test suite + endpoint validation
- iOS profile: `xcodebuild test`
- Android profile: `./gradlew test`
- Library profile: test suite + build
- Generic profile: user-defined validation script

**Custom Validation Scripts:**
Projects can define `.aigon/validation.sh` for custom checks:
```bash
#!/bin/bash
# Custom validation script
# Exit 0 for success, non-zero for failure

npm test || exit 1
npm run lint || exit 2
npm run type-check || exit 3
# Add any project-specific checks
exit 0
```

### Acceptance Criteria Checking

Parse acceptance criteria from the feature spec markdown:
```markdown
## Acceptance Criteria
- [ ] Feature X works correctly
- [ ] Tests pass
- [ ] Documentation updated
```

**Checking mechanism:**
1. Extract unchecked criteria from spec (`- [ ]` checkboxes)
2. Use LLM to evaluate each criterion against:
   - Code changes (git diff)
   - Test results
   - Build output
   - Implementation log
3. Auto-check criteria that are objectively verified (e.g., "tests pass")
4. For subjective criteria (e.g., "code quality is good"), use LLM judgment
5. Update spec file with checked criteria (`- [x]`)

**Example evaluation prompt:**
```
Given this acceptance criterion: "Feature X works correctly"

Code changes:
{git diff output}

Test results:
{test output}

Does this implementation satisfy the criterion? Answer YES or NO with brief reasoning.
```

### Iteration Logging

Each iteration creates a detailed log entry in the implementation log:

```markdown
## Iteration 1 (2024-02-13 10:15:23)

### Implementation
- Added feature X to component Y
- Created tests for edge cases
- Updated documentation

### Validation Results
- ✅ Tests: 15/15 passed
- ❌ Build: Failed (missing import)
- ✅ Lint: No issues
- ⚠️ Type check: 1 warning

### Acceptance Criteria Status
- [ ] Feature X works correctly (Tests pass, but build fails)
- [ ] Tests pass (15/15 tests passing)
- [ ] Documentation updated (README updated)

### Issues Found
1. Missing import in `components/Y.tsx`
2. Type warning in function signature

### Next Iteration Plan
- Fix missing import
- Resolve type warning
- Re-run validation

---

## Iteration 2 (2024-02-13 10:18:45)
...
```

### Agent Command Template Updates

**Update `feature-implement.md` template:**

```markdown
## Loop Mode (Ralph Wiggum Technique)

To enable autonomous iteration mode, add the `--loop` flag:

```bash
aigon feature-implement {{ARG1_SYNTAX}} --loop
```

This will:
1. Implement the feature
2. Run validation checks
3. Check acceptance criteria
4. If not satisfied, automatically fix issues and retry (up to 5 iterations)
5. Stop when all criteria are met or max iterations reached

**Configuration:**
- Max iterations: `--max-iterations=N` (default: 5)
- Custom validation: Define `.aigon/validation.sh` in project root
- Skip validation: `--skip-validation` (only check criteria)

**Interrupting the loop:**
- Press Ctrl+C to pause after current iteration completes
- Resume with `aigon feature-implement {{ARG1_SYNTAX}} --loop --resume`
```

### CLI Implementation Changes

**New CLI arguments for `feature-implement`:**
- `--loop` / `--ralph` - Enable autonomous iteration mode
- `--max-iterations=N` - Set maximum iterations (default: 5)
- `--skip-validation` - Skip validation checks, only check criteria
- `--resume` - Resume a previously interrupted loop
- `--validation-script=PATH` - Custom validation script path

**Configuration in `.aigon/config.json`:**
```json
{
  "profile": "web",
  "ralph": {
    "enabled": true,
    "maxIterations": 5,
    "validationScript": ".aigon/validation.sh",
    "autoCheckCriteria": true,
    "stopOnFirstFailure": false
  }
}
```

### Integration with Task Tracking

Tasks created from acceptance criteria are automatically updated during the loop:

1. **Before loop starts:** Create tasks from acceptance criteria (existing behavior)
2. **During each iteration:** Update task status based on validation:
   - Mark task as `in_progress` when working on related code
   - Mark task as `completed` when its criterion is verified
   - Add iteration notes to task description
3. **After loop completes:** All tasks should be `completed` or flagged for manual review

### Error Handling & Safety

**Infinite Loop Prevention:**
1. Hard limit on max iterations (default: 5, max: 20)
2. Detect repeating failures (same error 3+ times) and abort
3. Resource monitoring - abort if disk/memory issues detected
4. Timeout per iteration (configurable, default: 30 minutes)

**User Intervention:**
- Graceful handling of Ctrl+C - complete current iteration before stopping
- Save loop state to `.aigon/loop-state-{featureId}.json`
- Allow resume from last successful iteration
- Provide detailed failure report on abort

**Failure Modes:**
1. **Validation never passes** - Report unresolved issues, suggest manual intervention
2. **Criteria remain unchecked** - List subjective criteria needing human review
3. **Resource exhaustion** - Clean abort with state saved
4. **User interrupt** - Save state, allow resume

### Mode Compatibility

**Solo Mode (branch):**
- Loop runs in main repo on feature branch
- All iterations committed to same branch
- Final state when loop completes or is interrupted

**Solo Worktree Mode:**
- Loop runs in worktree directory
- Each iteration committed within worktree
- Return to main repo for `feature-done`

**Arena Mode:**
- Each agent runs their own loop in their worktree
- Iterations logged separately per agent
- Evaluation compares final results after all agents complete
- Agents may complete in different numbers of iterations

## Dependencies

- Existing `feature-implement` command and workflow
- Task tracking system (`TaskCreate`, `TaskUpdate`)
- Profile system for validation commands
- Git worktree support
- Agent command templates
- LLM API for criteria evaluation (using existing agent's model)

## Out of Scope

- Visual progress dashboard (terminal output only for now)
- Parallel iteration attempts (sequential only)
- Learning from previous features to improve iteration strategy
- Cross-feature learning (each loop is isolated)
- Automatic performance optimization (only correctness validation)
- Integration with external CI/CD systems (local validation only)
- Real-time collaboration (multi-user intervention during loop)

## Open Questions

1. **Criteria evaluation accuracy**: How reliable is LLM evaluation of subjective acceptance criteria? Should we require explicit user approval for subjective criteria?

2. **Iteration budget**: Is 5 iterations a good default? Should it vary by feature complexity?

3. **Validation timeout**: What's a reasonable per-iteration timeout? 30 minutes? Should it be configurable per profile?

4. **Resume behavior**: When resuming an interrupted loop, should we:
   - Start from last successful iteration?
   - Re-run the last iteration with fresh context?
   - Let user choose?

5. **Arena mode coordination**: Should all agents in arena mode complete their loops before evaluation, or can we evaluate incrementally?

6. **Cost implications**: Running multiple iterations with LLM calls could be expensive. Should we:
   - Add cost warnings before starting?
   - Use cheaper models for criteria checking?
   - Provide dry-run mode?

7. **Validation cache**: Should we cache validation results for unchanged code to speed up iterations?

8. **Partial success**: If 90% of criteria are met but one fails after max iterations, should we:
   - Commit the partial implementation?
   - Rollback everything?
   - Let user decide?

## Related

- Research: Automated testing strategies for AI-generated code
- Research: LLM-based code evaluation reliability
- Feature: `feature-implement` command (will be extended)
- Feature: Task tracking system (integration point)
- Feature: Profile system (validation commands per profile)
