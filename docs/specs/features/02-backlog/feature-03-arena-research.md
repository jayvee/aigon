# Feature: arena-research

## Summary

Enable arena mode for research topics where multiple AI models (Claude, Gemini, Codex) contribute findings simultaneously. Unlike feature arena mode which uses separate worktrees and branches, research arena uses a simpler approach: each model writes to its own findings file on the same branch. This feature extends existing commands (`research-start`, `research-done`) rather than adding new ones.

## User Stories

- [ ] As a user, I want to start parallel research with multiple models so I can get diverse perspectives on a research topic
- [ ] As a user, I want each model's findings clearly attributed so I can understand which model contributed what
- [ ] As a user, I want a simple workflow that doesn't require managing multiple branches for research
- [ ] As a user, I want to synthesize findings from multiple models into a unified recommendation

## Acceptance Criteria

- [ ] `research-start <ID> [agents...]` extended to support arena mode when agents specified
- [ ] `research-done <ID>` extended to detect arena mode and display findings summary
- [ ] Agent command template `research-start` updated to be arena-aware (detects findings file)
- [ ] Findings files created in `docs/specs/research-topics/logs/`
- [ ] Main research doc remains authoritative record; findings files are supporting evidence
- [ ] No new CLI commands required

## Technical Approach

### Design Decision: Command Reuse

Extend existing commands with optional parameters rather than creating new commands:

| Command | Current Behavior | Extended Behavior |
|---------|------------------|-------------------|
| `research-start <ID>` | Move to in-progress | Same (solo mode) |
| `research-start <ID> <agents...>` | N/A | Create findings files + move to in-progress (arena mode) |
| `research-done <ID>` | Move to done | Auto-detect mode; show findings summary if arena |

### Solo Mode vs Arena Mode

#### Solo Mode (Single Agent)

**When to use:** One agent researches a topic independently.

**Command:** `aigon research-start <ID>`

**Behavior:**
- Moves research file from `02-backlog/` to `03-in-progress/`
- Agent writes findings directly to the main research document
- No additional files created

**File structure:**
```
docs/specs/research-topics/
└── 03-in-progress/
    └── research-05-topic.md    # Agent writes findings here
```

**Workflow:**
```
aigon research-create topic-name
aigon research-prioritise topic-name     → ID: 05
aigon research-start 05                  → solo mode
[Run agent] /aigon-research-start 05     → writes to main doc
aigon research-done 05                   → moves to done
```

**Agent command output (solo):**
```
Read the research topic and document your findings:
  docs/specs/research-topics/03-in-progress/research-05-topic.md

Write your findings in the ## Findings section of this document.
```

---

#### Arena Mode (Multiple Agents)

**When to use:** Multiple agents research the same topic to get diverse perspectives.

**Command:** `aigon research-start <ID> <agent1> <agent2> [...]`

**Behavior:**
- Creates `logs/` directory if needed
- Creates empty findings file for each agent: `research-{ID}-{agent}-findings.md`
- Moves research file from `02-backlog/` to `03-in-progress/`
- Each agent writes to their own findings file (not the main doc)

**File structure:**
```
docs/specs/research-topics/
├── 03-in-progress/
│   └── research-05-topic.md           # Main doc: questions, scope, final recommendation
└── logs/
    ├── research-05-cc-findings.md     # Claude's findings
    └── research-05-gg-findings.md     # Gemini's findings
```

**Workflow:**
```
aigon research-create topic-name
aigon research-prioritise topic-name     → ID: 05
aigon research-start 05 cc gg            → arena mode, creates findings files
[Run Claude]  /aigon-research-start 05   → writes to research-05-cc-findings.md
[Run Gemini]  /aigon:research-start 05   → writes to research-05-gg-findings.md
aigon research-done 05                   → shows summary, moves to done
```

**Agent command output (arena - when findings file exists):**
```
Read the research topic:
  docs/specs/research-topics/03-in-progress/research-05-topic.md

Document YOUR findings in your dedicated file:
  docs/specs/research-topics/logs/research-05-cc-findings.md

Important:
- Write only to YOUR findings file
- Do not modify other agents' files or the main research doc
- The main doc contains the questions and scope to research
```

---

### Mode Comparison Table

| Aspect | Solo Mode | Arena Mode |
|--------|-----------|------------|
| Command | `research-start 05` | `research-start 05 cc gg` |
| Agents | 1 | 2+ |
| Findings location | Main research doc | Separate files per agent |
| Files created | None | `research-{ID}-{agent}-findings.md` |
| Git conflicts | N/A | None (separate files) |
| Synthesis | Not needed | User writes recommendation after reviewing |
| `research-done` | Simple move | Shows findings summary, then moves |

---

### How Arena Mode is Detected

The system detects arena mode by checking for findings files:

```javascript
// In research-done and agent commands
const findingsFiles = glob.sync(`logs/research-${id}-*-findings.md`);
const isArenaMode = findingsFiles.length > 0;
```

This allows:
- `research-start 05 cc gg` to explicitly start arena mode
- `research-done 05` to auto-detect and show summary
- Agent commands to auto-detect and route to correct file

---

### The Synthesis Step (in `research-done`)

When `research-done` detects arena mode (findings files exist), it:

1. **Finds** all `research-{ID}-*-findings.md` files
2. **Displays** each agent's key findings and recommendation
3. **Prompts** user: "Review findings above. Update the main research doc with your unified recommendation, then run `research-done {ID}` again."
4. **On second run** (or with `--force`): Moves to done

Example output:
```
📋 Research 05: topic-name - Arena Mode Detected

Found 2 agent findings:

─── Claude (cc) ───────────────────────────────────
Key findings: [summary of cc findings]
Recommendation: [cc's recommendation]

─── Gemini (gg) ───────────────────────────────────
Key findings: [summary of gg findings]
Recommendation: [gg's recommendation]

───────────────────────────────────────────────────

Next steps:
1. Review the findings above
2. Update the ## Recommendation section in the main research doc
3. Run: aigon research-done 05 --complete
```

---

### Findings File Template

Created by `research-start` in arena mode:

```markdown
# Research Findings: {TOPIC_NAME}

**Agent:** {AGENT_NAME} ({AGENT_ID})
**Research ID:** {ID}
**Date:** {DATE}

---

## Key Findings

<!-- Document discoveries, options evaluated, pros/cons -->

## Sources

<!-- Links to documentation, articles, code examples -->

## Recommendation

<!-- This agent's recommended approach based on findings -->
```

---

### Implementation Changes

**1. Extend `research-start` command**
```javascript
case 'research-start':
  const [id, ...agents] = args;

  if (agents.length > 0) {
    // Arena mode
    ensureDir('docs/specs/research-topics/logs');
    for (const agent of agents) {
      createFindingsFile(id, agent);
    }
  }

  // Move to in-progress (both modes)
  moveToInProgress(id);

  // Output next steps
  if (agents.length > 0) {
    console.log(`Arena mode: Run each agent with /aigon-research-start ${id}`);
  } else {
    console.log(`Solo mode: Run agent with /aigon-research-start ${id}`);
  }
```

**2. Extend `research-done` command**
```javascript
case 'research-done':
  const findingsFiles = findFindingsFiles(id);

  if (findingsFiles.length > 0 && !args.includes('--complete')) {
    // Arena mode: show summary first
    displayFindingsSummary(id, findingsFiles);
    console.log(`\nRun: aigon research-done ${id} --complete`);
    return;
  }

  // Move to done (both modes)
  moveToDone(id);
```

**3. Update agent command template: `research-start.md`**

Make template arena-aware using conditional logic:

```markdown
# Template: research-start.md

Read the research topic:
  `docs/specs/research-topics/03-in-progress/research-{ID}-*.md`

{{#if FINDINGS_FILE}}
Document YOUR findings in your dedicated file:
  `docs/specs/research-topics/logs/research-{ID}-{AGENT_ID}-findings.md`

Important:
- Write only to YOUR findings file
- Do not modify other agents' files or the main research doc
{{else}}
Document your findings in the ## Findings section of the research topic file.
{{/if}}
```

**4. New template: `research-findings-template.md`**
- Standard structure for agent findings files
- Used by `research-start` when creating arena findings files

---

## Dependencies

- Existing research commands (create, prioritise, start, done)
- Agent configuration system (`templates/agents/*.json`)
- Command template system with conditional support

## Out of Scope

- Automatic LLM-powered synthesis (manual review first, can add later)
- Orchestration layer to run multiple agents automatically
- Merging findings files into main doc (they remain as supporting evidence)

## Open Questions

- Should findings files be archived after `research-done`? (e.g., move to `logs/archive/`)
- Should `research-start` auto-commit the created findings files?
- Should agents be able to append to findings (multiple contributions) or overwrite?

## Related

- Feature arena mode: `feature-setup`, `feature-eval`
- Research workflow: `research-create`, `research-start`, `research-done`
- Agent configs: `templates/agents/*.json`
