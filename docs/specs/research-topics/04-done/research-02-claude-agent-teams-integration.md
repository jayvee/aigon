# Research: Claude Agent Teams Integration

## Context

Claude Code now has an experimental **Agent Teams** feature that enables multiple Claude Code instances to work together with shared task lists, inter-agent messaging, and coordinated delegation. This is architecturally similar to Aigon's arena mode, which uses git worktrees to run multiple agents in parallel on the same feature or research topic.

Aigon's current multi-agent approach:
- **Arena mode**: separate git worktrees per agent, isolated contexts, no inter-agent communication
- **Research arena**: each agent writes to their own findings file, then a synthesis step compares results
- **Feature arena**: each agent implements independently, then an eval step compares implementations

Claude Agent Teams offer:
- **Shared task lists** with dependency tracking and automatic unblocking
- **Inter-agent messaging** (direct messages and broadcasts)
- **Team lead coordination** with delegate mode
- **Plan approval workflows** where the lead reviews teammate plans before implementation
- **Hooks** (`TeammateIdle`, `TaskCompleted`) for quality gates
- **Split-pane or in-process display** modes

The core question: how should Aigon leverage agent teams to improve its research and feature workflows, and what changes are needed to make them work together?

Reference: https://code.claude.com/docs/en/agent-teams

## Questions to Answer

- [x] How does Aigon's arena mode compare to Claude Agent Teams, and where does each approach have advantages?
  - Arena mode: file isolation via worktrees, works across different agent CLIs (cc, gg, cx), post-hoc comparison
  - Agent teams: real-time coordination, shared context, but Claude Code only
  - **Finding**: They solve different problems — arena is cross-agent competition, teams are CC-only collaboration. They should coexist.

- [x] How could agent teams enhance `research-conduct` in arena mode?
  - Current: each agent writes independently to their own findings file, no interaction
  - Agent teams enable "scientific debate" — agents can challenge each other's findings in real time
  - **Finding**: Teams are ideal for research — adversarial debate produces higher-quality findings than isolated research. The team lead can synthesise automatically.

- [x] How could agent teams enhance `feature-implement` in arena mode?
  - Current: agents implement independently in worktrees, then `feature-eval` compares
  - **Finding**: Teams enable a new "collaborative" mode where teammates own different layers (frontend/backend/tests) in a single branch, complementing the existing "competition" mode.

- [x] What new Aigon commands or modes should be introduced for team-based workflows?
  - **Finding**: Add a `--team` flag to `research-setup` and `feature-setup`. No new top-level commands needed — team lifecycle is managed by the lead session, not by aigon CLI.

- [x] How should Aigon's spec and log files integrate with agent team task lists?
  - **Finding**: Aigon spec remains source of truth. The team lead reads the spec and creates team tasks from acceptance criteria. Implementation logs are written per-teammate to separate files.

- [x] What are the limitations and risks of depending on agent teams?
  - **Finding**: Experimental status is the main risk. Mitigation: agent teams are an optional enhancement, not a replacement for worktree arena mode. Cross-agent identity preserved because worktree mode remains for mixed-agent scenarios.

## Scope

### In Scope
- Comparison of Aigon arena mode vs. Claude Agent Teams architecture
- Integration patterns for research workflows (conduct, synthesize, done)
- Integration patterns for feature workflows (setup, implement, eval, done)
- New command design or flag additions to existing commands
- Task list and spec file synchronisation strategy
- Prompt engineering for team-based research (debate, challenge, synthesis)
- Impact on the existing worktree-based workflow (coexistence vs. replacement)

### Out of Scope
- Implementing the integration (this is research only)
- Agent teams support for non-Claude agents (Gemini, Codex, Cursor)
- Changes to the core agent teams feature in Claude Code itself
- MCP server integration (covered by separate research topic)
- Pricing or token cost optimisation

## Findings

### 1. Arena Mode vs. Agent Teams: Architectural Comparison

| Dimension | Aigon Arena Mode | Claude Agent Teams |
|-----------|-----------------|-------------------|
| **Isolation** | Git worktrees (full filesystem isolation) | Shared working directory |
| **Agents** | Any supported CLI (cc, gg, cx, cu) | Claude Code only |
| **Communication** | None (post-hoc comparison only) | Real-time messaging + shared task list |
| **Coordination** | Human-driven (user runs eval/done) | Lead agent coordinates autonomously |
| **File conflicts** | Impossible (separate worktrees) | Must be managed (same directory) |
| **Token cost** | Lower (each agent runs independently) | Higher (team overhead, messaging) |
| **Context** | Each agent loads fresh from worktree | Each teammate loads project context + spawn prompt |
| **State** | File-based (worktrees, logs, specs) | JSON-based (`~/.claude/tasks/`, `~/.claude/teams/`) |
| **Paradigm** | Competition (pick a winner) | Collaboration (divide and conquer) |
| **Session mgmt** | User opens each terminal manually | Lead spawns/manages teammates |

**Key insight**: These are complementary, not competing. Arena mode excels at **cross-agent competition** where you want to compare fundamentally different approaches. Agent teams excel at **coordinated collaboration** where teammates own different pieces of a larger task and need to communicate.

**Coexistence model**:
- **Arena mode stays** for cross-agent scenarios (cc vs gg vs cx) and competitive evaluation
- **Agent teams add** a new CC-only collaborative mode for research and features

### 2. Research Workflow Enhancement

**Current research arena flow**:
```
research-setup 05 cc gg
  → Creates findings files (no worktrees)
  → Each agent writes independently
  → No interaction between agents
research-synthesize 05
  → Separate agent reads all findings
  → Compares consensus vs divergent views
  → User selects features
research-done 05 --complete
```

**Agent teams could transform this into**:
```
research-setup 05 --team
  → Creates a Claude agent team
  → Lead reads research doc questions
  → Spawns teammates with specific research angles
  → Teammates investigate, message each other, challenge findings
  → Lead synthesises automatically
  → Lead writes consolidated findings + recommendation
research-done 05
```

**Why teams are particularly strong for research**:

The Claude Agent Teams docs explicitly highlight research as a top use case: _"multiple teammates can investigate different aspects of a problem simultaneously, then share and challenge each other's findings"_. The adversarial debate pattern — where teammates actively try to disprove each other's theories — produces higher-quality findings than isolated research.

**Prompt structure for team-based research**:

The team lead should receive:
1. The full research doc (context, questions, scope)
2. Instructions to spawn N teammates, each assigned specific questions
3. Instructions to use delegate mode (lead coordinates, doesn't research)
4. Instructions to require plan approval before teammates begin investigating
5. After all teammates report findings, the lead synthesises and writes to the research doc

**Impact on existing commands**:
- `research-setup` gains `--team` flag → creates agent team instead of findings files
- `research-conduct` becomes unnecessary (lead handles orchestration)
- `research-synthesize` becomes unnecessary (lead synthesises automatically)
- `research-done` remains unchanged (moves to done)

### 3. Feature Workflow Enhancement

**Current feature arena flow**:
```
feature-setup 55 cc gg cx
  → Creates 3 worktrees, 3 branches, 3 logs
  → User opens each worktree terminal
  → Each agent implements independently
feature-eval 55
  → Separate agent compares all implementations
  → Recommends winner
feature-done 55 cc
  → Merges winner, archives logs
```

**Agent teams enable a new collaborative mode**:
```
feature-setup 55 --team
  → Creates single branch (no worktrees)
  → Creates agent team
  → Lead reads spec, breaks into tasks with dependencies
  → Spawns teammates: e.g., one for backend, one for frontend, one for tests
  → Teammates claim tasks, coordinate via messages
  → Lead reviews completion, runs quality gates
feature-done 55
  → Standard merge (single branch)
```

**Two distinct modes should coexist**:

1. **Arena mode** (existing, competition): Multiple agents in separate worktrees, each implements the full feature independently, eval picks a winner. Best when you want to compare different approaches.

2. **Team mode** (new, collaboration): Multiple Claude Code teammates in a shared branch, each owns a different slice of the feature, coordinated by a lead. Best when the feature is large enough to decompose and you want faster completion.

**File conflict handling**:

The agent teams docs warn: _"Two teammates editing the same file leads to overwrites. Break the work so each teammate owns a different set of files."_ This maps well to layer-based decomposition:
- Teammate 1: backend API endpoints
- Teammate 2: frontend components
- Teammate 3: tests and documentation

The team lead should include file ownership boundaries in spawn prompts.

**Implementation logs**:

In team mode, each teammate should write to their own log file (similar to arena mode findings files), so the history of each teammate's decisions is preserved. The lead can also maintain a coordination log.

### 4. New Commands and Modes

**Recommendation: extend existing commands, don't add new top-level commands.**

The team lifecycle (create team, spawn teammates, cleanup) is handled natively by Claude Code's agent teams feature. Aigon doesn't need to replicate this. Instead, Aigon should:

1. **Add `--team` flag to `feature-setup`**:
   ```bash
   aigon feature-setup 55 --team
   ```
   - Creates a single branch (no worktrees)
   - Generates a `.claude/hooks/hooks.json` with `TeammateIdle` and `TaskCompleted` hooks for quality gates
   - Outputs a prompt the user pastes into Claude Code to start the team
   - Or: directly launches `claude` with the appropriate prompt via subprocess

2. **Add `--team` flag to `research-setup`**:
   ```bash
   aigon research-setup 05 --team
   ```
   - Moves topic to in-progress
   - Generates the team spawn prompt with research questions embedded
   - Outputs prompt or launches `claude`

3. **No `aigon team-start` / `aigon team-stop`**: Team lifecycle is Claude Code's responsibility. Aigon sets up the project state and generates the prompt, then hands off to the team lead.

**Orchestration model**:

The human-driven Aigon session should NOT become the team lead. Instead:
- User runs `aigon feature-setup 55 --team` (sets up project state)
- User starts a fresh Claude Code session
- That session becomes the team lead
- The lead reads the spec from Aigon's file structure, creates tasks, spawns teammates
- The lead uses Aigon's CLAUDE.md and commands as context

This separation keeps Aigon as the project-level orchestrator and Claude Code as the session-level orchestrator.

### 5. Spec/Log File Integration with Team Task Lists

**Aigon spec remains the source of truth.**

The team lead reads acceptance criteria from the spec and creates team tasks from them. This is a one-way flow:

```
Aigon spec (file) → Lead reads → Team tasks (JSON)
                                    ↓
                              Teammates work
                                    ↓
                              Tasks complete
                                    ↓
                              Lead writes summary → Aigon log (file)
```

**Key decisions**:

- **Don't synchronise** Aigon specs with team task lists bidirectionally. The spec is static; tasks are ephemeral.
- **`CLAUDE_CODE_TASK_LIST_ID`** environment variable can be set to `aigon-feature-55` so tasks are namespaced per feature.
- **Implementation logs**: Each teammate writes to a separate log file following Aigon naming convention: `feature-55-teammate-{name}-log.md`. The lead writes a coordination summary.
- **Team config** lives at `~/.claude/teams/{team-name}/config.json` — Aigon doesn't need to manage this.

**Hook integration**:

Aigon can generate `.claude/hooks/hooks.json` during `--team` setup:

```json
{
  "hooks": {
    "TaskCompleted": [{
      "hooks": [{
        "type": "command",
        "command": "aigon hook task-completed"
      }]
    }],
    "TeammateIdle": [{
      "hooks": [{
        "type": "command",
        "command": "aigon hook teammate-idle"
      }]
    }]
  }
}
```

These hook scripts could:
- `TaskCompleted`: Verify tests pass, check for linting errors (exit 2 to block completion)
- `TeammateIdle`: Check if the teammate's log file is populated, verify commits exist (exit 2 to keep working)

### 6. Limitations and Risks

**Agent teams are experimental**:
- Feature is behind `CLAUDE_CODE_EXPERIMENTAL_AGENT_TEAMS` flag
- API may change or be removed
- Mitigation: Team mode is strictly additive. Worktree arena mode remains the default and is unaffected.

**Claude Code only**:
- Agent teams only work with Claude Code sessions
- Cannot use Gemini, Codex, or Cursor as teammates
- Mitigation: Arena mode (worktrees) remains for cross-agent scenarios. Team mode is a CC-only enhancement.

**No session resumption**:
- If the lead session dies, in-process teammates are lost
- Mitigation: Teammates write findings/logs to Aigon's file structure, so work is preserved even if the session crashes. The user can restart and pick up from files.

**One team per session, no nesting**:
- Can't run multiple features as teams simultaneously from one session
- Mitigation: Each feature gets its own independent team session.

**Higher token cost**:
- Each teammate is a full Claude Code instance
- Mitigation: Document cost implications. For small features, recommend solo mode. Reserve team mode for features with 4+ acceptance criteria or complex research topics.

**File conflicts in shared directory**:
- Teammates editing the same file will overwrite each other
- Mitigation: Team lead must assign clear file ownership. Aigon's spawn prompt template should include boundaries.

**Cross-agent identity**:
- Aigon's identity is cross-agent (works with cc, gg, cx, cu)
- Adding a CC-only team mode doesn't compromise this — it's an optional enhancement
- The `--team` flag is explicitly Claude Code only, while the default arena mode remains agent-agnostic

**Sources**:
- [Claude Code Agent Teams](https://code.claude.com/docs/en/agent-teams)
- [Claude Code Subagents](https://code.claude.com/docs/en/sub-agents)
- [Claude Code Hooks](https://code.claude.com/docs/en/hooks)
- [Claude Code Interactive Mode (Task List)](https://code.claude.com/docs/en/interactive-mode)

## Recommendation

### Strategy: Add Team Mode as an Optional Enhancement to Arena Mode

**Do not replace arena mode.** Add a `--team` mode as a CC-only collaborative alternative. The two modes serve different purposes:

| Use Case | Recommended Mode |
|----------|-----------------|
| Cross-agent competition (cc vs gg) | Arena (worktrees) |
| Large feature decomposition | Team (collaborative) |
| Research with debate/challenge | Team (adversarial) |
| Quick solo implementation | Solo (branch) |
| Parallel solo development | Solo worktree |

### Implementation Approach

**Phase 1: Research team mode** (high priority)
- Add `--team` flag to `research-setup`
- Generate a team spawn prompt that includes the research doc questions
- The team lead handles conduct + synthesis automatically
- `research-done` works unchanged

**Phase 2: Feature team mode** (medium priority)
- Add `--team` flag to `feature-setup`
- Create branch (no worktrees), generate spawn prompt
- Generate `.claude/hooks/hooks.json` with quality gate hooks
- The team lead breaks spec into tasks, spawns teammates, coordinates
- `feature-done` works unchanged (single branch merge)

**Phase 3: Hook scripts for quality gates** (medium priority)
- `aigon hook task-completed` — verify tests pass before marking task done
- `aigon hook teammate-idle` — verify log file and commits before allowing idle

**Phase 4: Prompt templates** (medium priority)
- Create team lead prompt templates in `templates/generic/team/`
- Templates include: research lead prompt, feature lead prompt, teammate prompts
- Use existing placeholder system for profile-specific instructions

### Why This Approach

1. **Non-breaking**: Arena mode and solo mode are completely unaffected
2. **Minimal CLI changes**: Just a `--team` flag on two existing commands
3. **Leverages Claude Code**: Team lifecycle managed by CC, not by Aigon
4. **File-based state preserved**: Specs, logs, and findings still live in Aigon's directory structure
5. **Graceful degradation**: If agent teams feature is removed, `--team` flag just stops working; all other modes continue

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| research-team-mode | Add `--team` flag to `research-setup` to spawn a Claude Agent Team for collaborative research with debate | high | none |
| feature-team-mode | Add `--team` flag to `feature-setup` to spawn a Claude Agent Team for collaborative feature implementation | medium | research-team-mode |
| team-quality-gate-hooks | Generate `.claude/hooks/hooks.json` with `TaskCompleted` and `TeammateIdle` hooks during team setup | medium | feature-team-mode |
| team-prompt-templates | Create team lead and teammate prompt templates in `templates/generic/team/` with profile placeholder support | medium | research-team-mode |

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
