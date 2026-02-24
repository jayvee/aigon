# Feature 18: Conductor

## Summary

An orchestration layer that manages multiple agents working in parallel — the "Aigon Pro" mode. The Conductor coordinates multiple Ralph loops across different agents, assigns tasks, monitors progress, and synthesizes results. This transforms Aigon from a tool that helps you run agents into a tool that runs agents for you.

Where Ralph (Feature 16) is one agent looping on one task, the Conductor is the layer above: deciding which agent gets which task, monitoring all loops, and knowing when the whole project is done.

## User Stories

- [ ] As a developer, I want to assign a feature to multiple agents and have them work in parallel without me managing each terminal
- [ ] As a developer, I want the conductor to automatically evaluate and pick the best implementation from competing agents
- [ ] As a developer, I want a single command that decomposes a large feature into tasks and distributes them across agents
- [ ] As a team lead, I want to see the status of all running agents and their progress from one place
- [ ] As a developer, I want the conductor to handle agent failures gracefully (retry, reassign, or flag for human review)

## Acceptance Criteria

- [ ] New command `aigon conduct <feature-id>` starts the conductor for a feature
- [ ] Conductor decomposes feature spec into discrete tasks (using LLM)
- [ ] Tasks assigned to available agents based on configuration
- [ ] Each agent runs a Ralph loop independently in its own worktree
- [ ] Conductor monitors agent progress via their progress files
- [ ] Conductor detects when an agent's loop completes or fails
- [ ] Arena mode: multiple agents implement the same task, conductor evaluates and picks best
- [ ] Pipeline mode: agents work on different tasks in sequence or parallel
- [ ] Status dashboard shows all agents, their current task, iteration count, and status
- [ ] Conductor writes a synthesis report when all work completes
- [ ] Graceful handling of agent crashes (detect, report, optionally reassign)

## Technical Approach

### Architecture

```
Conductor (aigon conduct)
├── Agent 1 (cc) — Ralph loop on Task A
│   ├── Iteration 1 → commit → validate → fail
│   ├── Iteration 2 → commit → validate → success
│   └── Done
├── Agent 2 (gg) — Ralph loop on Task A (arena)
│   ├── Iteration 1 → commit → validate → fail
│   ├── Iteration 2 → commit → validate → fail
│   ├── Iteration 3 → commit → validate → success
│   └── Done
└── Agent 3 (cx) — Ralph loop on Task B (pipeline)
    ├── Waiting for Task A evaluation...
    └── (starts after conductor picks winner)
```

### Modes

**Arena Mode** (existing concept, elevated):
- Multiple agents implement the same feature/task
- Each runs their own Ralph loop in their own worktree
- Conductor waits for all to complete, then runs evaluation
- Best implementation is selected (using existing `feature-eval`)

**Pipeline Mode** (new):
- Feature decomposed into sequential tasks
- Agents assigned to different tasks
- Tasks can have dependencies (Task B waits for Task A)
- Conductor manages the dependency graph

**Swarm Mode** (future):
- All available agents work on a shared task pool
- Conductor assigns next available task to next idle agent
- Maximum parallelism, best for independent tasks

### Task Decomposition

Use LLM to break a feature spec into discrete, context-window-sized tasks:

```javascript
async function decomposeFeature(specContent) {
  const prompt = `Given this feature specification, decompose it into
  discrete implementation tasks. Each task should be completable in a
  single agent session. Return as a JSON array of tasks with:
  - title, description, acceptance_criteria, dependencies (other task indices)`;

  const tasks = await llmCall(prompt, specContent);
  return tasks;
}
```

### Progress Monitoring

Conductor polls agent progress files periodically:

```javascript
async function monitorAgents(agents) {
  for (const agent of agents) {
    const progressFile = `logs/feature-${id}-${agent.id}-ralph-progress.md`;
    const status = parseProgressFile(progressFile);

    if (status.lastIteration?.status === 'Success') {
      agent.state = 'completed';
    } else if (status.iteration >= agent.maxIterations) {
      agent.state = 'failed';
    }
  }
}
```

### Agent Lifecycle Management

```javascript
// Spawn agent Ralph loop in worktree
function spawnAgent(agent, task, worktreePath) {
  const cmd = `aigon ralph ${task.featureId} --agent=${agent.id}`;
  const proc = spawn(cmd, { cwd: worktreePath, detached: true });

  // Monitor for crashes
  proc.on('exit', (code) => {
    if (code !== 0) handleAgentFailure(agent, task, code);
  });

  return proc;
}
```

### Status Dashboard

Terminal output showing all agents:

```
Conductor: Feature 16 — Ralph Wiggum Loop
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

Agent   Task           Iteration  Status
cc      Core loop      3/5        In progress
gg      Core loop      2/5        In progress
cx      Validation     1/5        Waiting (blocked by core loop)

Last update: 10:23:45
```

### CLI Commands

- `aigon conduct <feature-id>` — start conductor
- `aigon conduct <feature-id> --mode=arena|pipeline|swarm`
- `aigon conduct <feature-id> --agents=cc,gg,cx`
- `aigon conduct status` — show dashboard
- `aigon conduct stop` — gracefully stop all agents

### Configuration

```json
{
  "conductor": {
    "defaultMode": "arena",
    "agents": ["cc", "gg"],
    "maxParallelAgents": 3,
    "evaluateOnComplete": true,
    "autoSelectWinner": false
  }
}
```

## Out of Scope

- Web-based dashboard (terminal only)
- Remote agent management (local agents only)
- Cost budgeting across agents
- Dynamic agent scaling (fixed agent pool)
- Cross-feature conductor (one feature at a time)

## Open Questions

1. **Task granularity**: How small should decomposed tasks be? One function? One file? One user story?
2. **Evaluation strategy**: Auto-pick winner or always require human evaluation?
3. **Failure policy**: When an agent fails max iterations, reassign to another agent or skip?
4. **Resource limits**: How many parallel Ralph loops can a machine handle before hitting rate limits or resource issues?
5. **Conductor persistence**: If the conductor process is killed, can it resume?

## Dependencies

- Feature 16: Ralph Wiggum Loop (each agent runs a Ralph loop)
- Feature 17: Smart Validation (criteria evaluation for completion detection)
- Existing arena mode (worktree setup, agent configs)
- Existing `feature-eval` command (for arena mode evaluation)

## Related

- Feature 16: Ralph Wiggum Loop (the building block)
- Feature 17: Smart Validation (criteria checking layer)
- Existing arena mode (Feature 18 replaces manual arena coordination)
