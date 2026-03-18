# Feature: e2e-mock-agent-solo

## Summary
Build a mock agent harness and e2e test that exercises the full solo worktree (Drive) lifecycle: `feature-create → prioritise → setup → do → submit → close`. The mock agent simulates realistic work by writing to log files with 10-20 second pauses between status transitions, allowing verification of dashboard state, notifications, and the state machine without burning real AI tokens. This also establishes the mock agent infrastructure reused by all subsequent e2e scenarios.

## User Stories
- [ ] As a developer, I can run `npm run test:e2e:mock-solo` and see the full solo worktree lifecycle pass in ~60 seconds
- [ ] As a developer, I can reuse the mock agent harness to build fleet, autonomous, and real-agent tests

## Acceptance Criteria

### Mock Agent Harness (`test/mock-agent.js`)
- [ ] Exports a `MockAgent` class that simulates an agent working in a worktree
- [ ] `MockAgent` accepts a config: `{ featureId, agentId, desc, repoPath, delays: { implementing, submitted } }`
- [ ] Delays default to `{ implementing: 15000, submitted: 10000 }` (15s working, 10s before submit)
- [ ] Writes realistic log file frontmatter transitions: `implementing → submitted`
- [ ] Each status update calls `updateLogFrontmatterInPlace()` (imported from `lib/utils.js`) to match real behavior
- [ ] Optionally writes dummy code changes to the worktree (a test file) and commits them
- [ ] Returns a Promise that resolves when the mock run is complete
- [ ] Supports `abort()` to cancel mid-run (for cleanup)

### E2E Test — Solo Worktree Happy Path (`test/e2e-mock-solo.test.js`)
- [ ] Uses existing fixture infrastructure (`test/setup-fixture.js`, `copyFixtureToTemp()`, mock tmux)
- [ ] Creates a feature via CLI: `aigon feature-create "mock-test-feature"`
- [ ] Prioritises it: `aigon feature-prioritise mock-test-feature`
- [ ] Sets up solo worktree: `aigon feature-setup <ID> cc`
- [ ] Verifies spec moved to `03-in-progress/`
- [ ] Verifies log file created with `status: implementing`
- [ ] Verifies worktree exists at expected path
- [ ] Runs `MockAgent` in the worktree — waits for it to complete (~25s)
- [ ] Verifies log file shows `status: submitted` after mock agent finishes
- [ ] Runs `aigon feature-close <ID>` from main repo
- [ ] Verifies spec moved to `05-done/`
- [ ] Verifies log moved to `logs/selected/`
- [ ] Verifies worktree removed
- [ ] Verifies feature branch deleted
- [ ] Verifies merge commit exists on main
- [ ] Total test time: ~60-90 seconds (dominated by mock agent pauses)

### Dashboard Integration (optional stretch)
- [ ] If dashboard is running, verify `/api/status` shows the feature progressing through stages
- [ ] Verify no "ready for eval" notification fires (solo worktree)

### No regressions
- [ ] Existing `npm test` and `npm run test:e2e` still pass
- [ ] `node -c test/mock-agent.js && node -c test/e2e-mock-solo.test.js` pass

## Validation
```bash
node -c test/mock-agent.js
node -c test/e2e-mock-solo.test.js
node test/e2e-mock-solo.test.js
```

## Technical Approach

### Mock Agent (`test/mock-agent.js`)
```js
class MockAgent {
  constructor({ featureId, agentId, desc, repoPath, delays }) { ... }

  async run() {
    // 1. Wait `delays.implementing` ms (simulates agent working)
    await sleep(this.delays.implementing);

    // 2. Write a dummy file + commit (simulates code changes)
    fs.writeFileSync(path.join(this.worktreePath, 'mock-implementation.js'), '// mock');
    execSync('git add . && git commit -m "feat: mock implementation"', { cwd: this.worktreePath });

    // 3. Wait `delays.submitted` ms
    await sleep(this.delays.submitted);

    // 4. Update log to submitted (using real updateLogFrontmatterInPlace)
    updateLogFrontmatterInPlace(this.logPath, { status: 'submitted', appendEvent: true });
    execSync('git add . && git commit -m "chore: submit"', { cwd: this.worktreePath });
  }
}
```

### Test Structure
Follow existing `test/e2e.test.js` patterns:
- Use `copyFixtureToTemp()` for isolation
- Use `runAigon()` helper for CLI invocation
- Use `readFrontmatter()` for log assertions
- Use `assertFileExists()` / `assertBranchExists()` helpers
- Run with: `node test/e2e-mock-solo.test.js` (separate from main e2e suite due to timing)

### Fixture Reuse
Uses the existing `brewboard` fixture (web profile). No new fixtures needed.

## Dependencies
- Existing test infrastructure: `test/setup-fixture.js`, `test/e2e.test.js` helpers
- `lib/utils.js` — `updateLogFrontmatterInPlace()`, `parseLogFrontmatterFull()`
- Mock tmux binary: `test/mock-bin/tmux`

## Out of Scope
- Fleet mode (that's e2e-mock-agent-fleet)
- Autonomous/Ralph loop (future scenario 5)
- Real agent execution (future scenarios 3, 7)
- Dashboard UI verification via Playwright (can be added later)

## Open Questions
- Should mock agent delays be configurable via env vars (e.g., `MOCK_DELAY=fast` for CI)?

## Related
- `test/e2e.test.js` — existing e2e test patterns to follow
- `test/setup-fixture.js` — fixture generation
- Scenario matrix: this is scenarios 1 (and foundation for 3, 5, 7)
