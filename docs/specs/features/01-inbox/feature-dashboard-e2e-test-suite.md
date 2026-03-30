# Feature: dashboard-e2e-test-suite

## Summary

Automated end-to-end test suite that validates every dashboard workflow — feature and research — from seed reset through agent sessions, submission, evaluation, and close. Tests simulate the full user experience: clicking dashboard buttons, verifying tmux sessions launch with correct commands, waiting for agents to submit, running eval, and closing. No human interaction required. The test suite is the gatekeeper — no aigon release ships without all flows passing.

## Background: why this is critical

On Mar 23 2026, we spent an entire day manually testing the dashboard. Every test revealed another broken handoff — wrong mode strings, missing server handlers, stale template references, uncommitted agent installs. The user tested 15+ seed resets. Every fix created a new bug. The fundamental problem: the dashboard has dozens of string-based handoff points between frontend, server, state machine, CLI, and tmux — and zero automated tests to verify them.

## What the tests cover

### Feature flows (Fleet mode: cc + gg)

1. **feature-start**: Click "Start feature" → agent picker → select cc, gg → verify:
   - State transitions to in-progress
   - Spec moved to 03-in-progress/
   - Two worktrees created
   - Two tmux sessions created with correct names
   - Agent commands include correct feature-do prompt

2. **agent-submit**: Simulate agent work → verify:
   - `aigon agent-status submitted` updates manifest
   - Dashboard shows "Submitted" status for each agent
   - "Run Evaluation" button appears

3. **feature-eval**: Click "Run Evaluation" → agent picker → select eval agent → verify:
   - State transitions to in-evaluation
   - Spec moved to 04-in-evaluation/
   - Tmux session created with eval command (not implement command)
   - Session name matches `{repo}-f{id}-eval` pattern

4. **feature-close**: Click "Close" → select winner → verify:
   - State transitions to done
   - Winner merged to main
   - Losing branches cleaned up
   - Worktrees removed
   - Tmux sessions killed (graceful Ctrl+C → wait → force)
   - Dev proxy entries cleaned up

### Research flows (Fleet mode: cc + gg)

5. **research-start**: Click "Start research" → agent picker → select cc, gg → verify:
   - State transitions to in-progress
   - Spec moved to 03-in-progress/
   - Two tmux sessions created (no worktrees — research uses branches)
   - Agent commands include correct research-do prompt

6. **research-submit**: Simulate agent findings → verify:
   - `aigon research-submit` updates status
   - Dashboard shows "Submitted" for each agent
   - "Run Evaluation" button appears (not "Synthesize")

7. **research-eval**: Click "Run Evaluation" → agent picker → select eval agent → verify:
   - State transitions to in-evaluation
   - Spec moved to 04-in-evaluation/
   - Tmux session created with research-eval command
   - Mode sent to server is `'eval'` (NOT `'synthesize'`)
   - Session name matches `{repo}-r{id}-eval-{agent}` pattern

8. **research-close**: Click "Close" → verify:
   - State transitions to done
   - Spec moved to 05-done/
   - Tmux sessions killed
   - No `--complete` flag needed

### Drive mode (single agent)

9. **feature-start-drive**: Start feature with single agent → verify branch created (no worktree)
10. **feature-close-drive**: Close drive feature → verify branch merged and deleted

### Edge cases

11. **submitted-agent-view**: After submit, "View" button appears and attaches to running tmux session
12. **eval-session-attach**: During eval, "View" button attaches to eval session (doesn't restart it)
13. **seed-reset-during-dashboard**: Reset seed while dashboard is polling → dashboard survives, recovers when repo reappears
14. **dev-server-auto-deps**: Dev server start with missing node_modules → auto-installs and retries

## Acceptance Criteria

- [ ] All 14 test scenarios pass on a freshly seeded brewboard
- [ ] Tests run via `npm test -- --e2e` or similar command
- [ ] Tests automatically seed-reset before the suite starts
- [ ] Each test verifies the actual tmux session name and command (not just that "something" launched)
- [ ] Each test verifies the state machine transition happened (check manifest + spec file location)
- [ ] Tests complete in under 5 minutes total (agents don't need to actually implement — just verify the session launches correctly)
- [ ] Test output clearly shows which flow failed and at which step
- [ ] Tests can run headless (no browser window needed for CI)

## Validation

```bash
npm test -- --e2e
```

## Technical Approach

### Layer 1: Server API tests (no browser needed)

Test the AIGON server's HTTP endpoints directly:
- `POST /api/dispatch` with various actions → verify correct CLI commands are built
- `POST /api/feature-open` with various modes → verify correct tmux commands
- `GET /api/status` → verify research/feature state is reported correctly

These catch the string-handoff bugs (like `'synthesize'` vs `'eval'`) without needing Playwright.

### Layer 2: CLI integration tests

Test the CLI commands that the dashboard dispatches:
- `aigon feature-start 01 cc gg` → verify worktrees + tmux sessions
- `aigon research-eval 01 --setup-only` → verify spec move without agent warning
- `aigon feature-close 01 cc` → verify merge + cleanup

### Layer 3: Playwright browser tests (full E2E)

Test the actual dashboard UI in a browser:
- Click buttons, verify state changes, check tmux sessions exist
- Uses Playwright with the dashboard running on a test port
- Seed-reset before each test suite run

### Test fixtures

- Use brewboard-seed as the test fixture (clone fresh for each suite)
- Mock agent work by directly writing findings/status files and running `aigon agent-status submitted`
- Don't wait for actual LLM responses — test the orchestration, not the agents

### Key assertions for every "open agent" flow

For every action that should create a tmux session, assert:
1. `tmux has-session -t <expected-name>` returns 0
2. The session's initial command contains the expected prompt/command
3. The server responded with `{ ok: true, sessionName: <expected-name> }`

## Dependencies

- Playwright (for browser tests)
- brewboard-seed repo (test fixture)
- AIGON server (must be running during tests)
- tmux (must be available)

## Out of Scope

- Testing actual LLM agent responses
- Testing agent code quality or implementation correctness
- Dashboard visual/CSS testing
- Performance benchmarks

## Open Questions

- Should we use a dedicated test port (e.g., 4199) for the dashboard during tests?
- Should Layer 1 (API tests) be a separate npm script from Layer 3 (Playwright)?

## Related

- Every bug fixed on Mar 23 2026 (seed-reset, mode string mismatch, missing server handlers, etc.)
- Feature: seed-reset-rewrite (seed must be reliable for tests)
- Feature: unified-pipeline-stages (#134, renamed research-synthesize → research-eval)
