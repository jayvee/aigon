# Research: simulate-agents

## Context

When major changes are made to the workflow engine, running end-to-end tests with real agents in brewboard is painfully slow. Even a simple feature like "add footer" takes 5-10 minutes with real agents (CC, GG, CX). We have unit tests and integration tests, but real agents reveal bugs that deterministic tests don't — because agents are non-deterministic in how they signal, when they commit, whether they run `agent-status submitted`, and how they handle errors.

The gap is between unit tests (fast, deterministic, no dashboard) and real agent tests (slow, non-deterministic, catch real bugs). We need something in the middle: simulated agents that exercise the real dashboard, real engine, real tmux sessions, and real signal paths — but without waiting for an LLM to generate code.

The key insight: most workflow bugs are about **lifecycle signalling**, not about **code quality**. The agent's job of writing code is irrelevant to testing the workflow. What matters is: does the agent signal `implementing`? Does it commit? Does it signal `submitted`? Does the dashboard update? Can the user then run eval? Does close work?

## Questions to Answer

### Fake Agent Design
- [ ] What is the simplest implementation of a fake agent? A bash script that sleeps, makes commits, and runs `aigon agent-status` commands?
- [ ] Should fake agents be registered as real agent types in `templates/agents/` (e.g., `fa.json` for "fake agent"), or should they be a mode of existing agents?
- [ ] What should a fake agent's lifecycle look like? `sleep 5 → git commit → sleep 3 → aigon agent-status submitted`?
- [ ] Should fake agents have configurable failure modes? (e.g., "crash after 3 seconds", "never signal submitted", "signal error midway")
- [ ] Should fake agents actually create git branches and commit real (trivial) code changes, or just signal without touching files?

### Integration with Dashboard
- [ ] Can the dashboard's polling loop detect fake agents the same way it detects real ones (tmux sessions, agent status files, engine signals)?
- [ ] Do fake agents need to run in tmux sessions for the dashboard to track them, or can they run as simple background processes?
- [ ] How do we ensure fake agents exercise the same code paths as real agents? (shell traps, heartbeats, engine signals)

### Test Orchestration
- [ ] How should a test runner orchestrate a fake-agent test? Script that runs `aigon feature-start 07 fa1 fa2` then waits for agents to "submit" then runs eval?
- [ ] What assertions should the test make? Dashboard API returns correct state at each step? Engine snapshots have correct events?
- [ ] How fast can a full solo lifecycle (start → implement → submit → close) run with fake agents? Target: under 10 seconds?
- [ ] How fast can a full fleet lifecycle (start → implement × 2 → submit × 2 → eval → close) run? Target: under 20 seconds?

### Failure Simulation
- [ ] How do we simulate an agent that crashes mid-work? (kill the tmux session, check dashboard shows "session lost")
- [ ] How do we simulate an agent that never signals? (let heartbeat expire, check dashboard shows "heartbeat expired")
- [ ] How do we simulate an agent that signals error? (run `aigon agent-status error`, check dashboard offers recovery actions)

### Existing Patterns
- [ ] Do the existing mock e2e tests (`test/e2e-mock-solo.test.js`, `test/e2e-mock-fleet.test.js`) already do something like this? Are they salvageable or should we start fresh?
- [ ] Are there open-source projects that simulate non-deterministic actors for workflow testing?

## Scope

### In Scope
- Design of fake/simulated agents that exercise real aigon infrastructure
- Integration with the real dashboard, real engine, real tmux
- Test orchestration for lifecycle scenarios
- Failure mode simulation
- Speed targets for test execution

### Out of Scope
- Testing agent code quality or LLM output
- Replacing the existing unit/integration test pyramid
- Building a CI/CD pipeline for these tests
- Testing research or feedback workflows (features first)

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs -->
- [ ] Feature: fake-agent-test-harness (or whatever the research recommends)
