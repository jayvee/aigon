# Feature: e2e-mock-agent-fleet

## Summary
E2E test exercising the full fleet (multi-agent) lifecycle with mock agents: `feature-create → prioritise → setup (2+ agents) → parallel do → all submit → eval (human picks winner) → close (merge winner)`. Two mock agents run in parallel with staggered delays, then the test simulates a human writing evaluation results and closing with a winner. Validates that the state machine, notifications, and dashboard correctly handle fleet transitions.

## User Stories
- [ ] As a developer, I can run `npm run test:e2e:mock-fleet` and see the full fleet lifecycle pass in ~90 seconds
- [ ] As a developer, I can verify that fleet-specific behavior (eval, winner selection, log organization) works end-to-end

## Acceptance Criteria

### Mock Agent Extensions
- [ ] `MockAgent` supports running multiple instances in parallel (from e2e-mock-agent-solo)
- [ ] Each mock agent writes distinct dummy code (different file names) to avoid merge conflicts
- [ ] Agents have staggered delays so they don't submit simultaneously (agent 1: 15s, agent 2: 20s)

### E2E Test — Fleet Happy Path (`test/e2e-mock-fleet.test.js`)

#### Setup Phase
- [ ] Creates a feature: `aigon feature-create "fleet-test-feature"`
- [ ] Prioritises it: `aigon feature-prioritise fleet-test-feature`
- [ ] Sets up fleet: `aigon feature-setup <ID> cc gg` (two agents)
- [ ] Verifies spec moved to `03-in-progress/`
- [ ] Verifies TWO worktrees created at expected paths
- [ ] Verifies TWO log files created: `feature-<ID>-cc-*-log.md` and `feature-<ID>-gg-*-log.md`
- [ ] Both logs show `status: implementing`

#### Parallel Execution Phase
- [ ] Runs two `MockAgent` instances in parallel (one per worktree)
- [ ] Agent `cc` submits after ~15s, agent `gg` after ~20s
- [ ] After cc submits: verify cc log shows `status: submitted`, gg still `implementing`
- [ ] After both submit: verify both logs show `status: submitted`
- [ ] Verify NO "ready for eval" notification fired before both agents submitted
- [ ] Verify "all-submitted" state is detectable after both submit

#### Evaluation Phase
- [ ] Runs `aigon feature-eval <ID>` from main repo
- [ ] Verifies spec moved to `04-in-evaluation/`
- [ ] Verifies evaluation file created: `docs/specs/features/evaluations/feature-<ID>-eval.md`
- [ ] Simulates human writing eval results: writes `**Winner: cc**` into the eval file and commits
- [ ] Verifies dashboard (if running) shows `evalStatus: 'pick winner'`

#### Close Phase
- [ ] Runs `aigon feature-close <ID> cc` (cc is the winner)
- [ ] Verifies spec moved to `05-done/`
- [ ] Verifies cc's log moved to `logs/selected/`
- [ ] Verifies gg's log moved to `logs/alternatives/` (or `logs/archived/`)
- [ ] Verifies cc's branch merged to main with `--no-ff`
- [ ] Verifies both worktrees removed
- [ ] Verifies both feature branches deleted
- [ ] Verifies merge commit on main contains cc's dummy code changes

#### State Machine Compliance
- [ ] At no point during the test does the system emit a notification or action that contradicts the state machine
- [ ] Solo-only actions (e.g., direct close without eval) are NOT available during fleet mode
- [ ] Fleet-only actions (eval, winner selection) ARE available at the right stages

### No Regressions
- [ ] Existing `npm test` and `npm run test:e2e` still pass
- [ ] `node -c test/e2e-mock-fleet.test.js` passes

## Validation
```bash
node -c test/mock-agent.js
node -c test/e2e-mock-fleet.test.js
node test/e2e-mock-fleet.test.js
```

## Technical Approach

### Parallel Mock Agents
```js
// Run two agents in parallel with staggered delays
const agentCC = new MockAgent({
  featureId: id, agentId: 'cc', desc, repoPath,
  delays: { implementing: 15000, submitted: 5000 }
});
const agentGG = new MockAgent({
  featureId: id, agentId: 'gg', desc, repoPath,
  delays: { implementing: 20000, submitted: 5000 }
});

await Promise.all([agentCC.run(), agentGG.run()]);
```

### Eval Simulation
Instead of launching a real AI agent to evaluate, the test directly:
1. Runs `aigon feature-eval <ID>` to create the eval template and move the spec
2. Writes `**Winner: cc**` into the eval markdown (simulating human/agent judgment)
3. Commits the eval result
4. Runs `aigon feature-close <ID> cc`

### Dashboard Assertions (optional)
If the dashboard is running on port 4100, the test can hit `/api/status` at key points to verify:
- Feature shows correct stage
- Agent statuses match log file frontmatter
- Valid actions match expected state machine output

### Test File Structure
```
test/
  mock-agent.js              # MockAgent class (from solo feature)
  e2e-mock-solo.test.js      # Solo scenario (from solo feature)
  e2e-mock-fleet.test.js     # Fleet scenario (this feature)
```

### Timing
- Setup phase: ~5s (CLI commands)
- Agent cc working: 15s, submits at ~20s
- Agent gg working: 20s, submits at ~25s
- Eval + close: ~5s
- Total: ~30-35s (can be parallelized with solo test)

## Dependencies
- **e2e-mock-agent-solo** — must be implemented first (provides `MockAgent` class and test helpers)
- Existing test infrastructure: `test/setup-fixture.js`, fixture repos
- `lib/utils.js` — `updateLogFrontmatterInPlace()`, `parseLogFrontmatterFull()`
- Mock tmux: `test/mock-bin/tmux`

## Out of Scope
- Autonomous/Ralph loop in fleet mode (future scenario 6)
- Real agent fleet execution (future scenario 4, 8)
- Adoption (`--adopt`) flow
- Autopilot (`feature-autopilot`) flow
- Dashboard UI verification via Playwright

## Open Questions
- Should the test verify that gg's code is NOT on main after close (only cc's was merged)?
- Should the eval file content match the real template format, or is `**Winner: cc**` sufficient?

## Related
- **e2e-mock-agent-solo** — prerequisite, provides MockAgent harness
- `test/e2e.test.js` — existing e2e patterns
- `lib/commands/feature.js:770-1100` — feature-eval implementation
- Scenario matrix: this is scenario 2 (and foundation for 4, 6, 8)
