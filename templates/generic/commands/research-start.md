<!-- description: Start research <ID> [agents...] - begin Drive or Fleet research -->
# aigon-research-start

Prepare to conduct research in either Drive or Fleet mode.

## Usage

```bash
# Drive mode (single agent)
aigon research-start {{ARG1_SYNTAX}}

# Fleet mode (multiple agents)
aigon research-start {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in the backlog:
1. List all files in `./docs/specs/research-topics/02-backlog/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Mode Selection

The mode is determined automatically based on parameters:
- **No agents**: Drive mode - one agent researches the topic
- **2+ agents**: Fleet mode - multiple agents research in parallel

## Drive Mode

Sets up for a single agent to research the topic.

Example:
```bash
aigon research-start 05
```

This will:
- Move topic to in-progress

Next steps:
```bash
{{CMD_PREFIX}}research-do 05     # Conduct the research
```

## Fleet Mode

Sets up for multiple agents to research the same topic in parallel.

Example:
```bash
aigon research-start 05 cc gg
```

This will:
- Move topic to in-progress
- Create findings files for each agent:
  - `logs/research-05-cc-findings.md` (Claude)
  - `logs/research-05-gg-findings.md` (Gemini)

Next steps:
1. Run `{{CMD_PREFIX}}research-open 05` to open all agents side-by-side
2. Each agent writes to their own findings file
3. After all agents complete, run `{{CMD_PREFIX}}research-synthesize 05` to compare and select features

## Important Notes

- **Drive mode**: Agent writes findings directly to the main research doc
- **Fleet mode**: Each agent writes ONLY to their own findings file
- Fleet mode requires at least 2 agents
- Findings files are created in `docs/specs/research-topics/logs/`


## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

- **Drive mode**: `{{CMD_PREFIX}}research-do <ID>`
- **Fleet mode**: `{{CMD_PREFIX}}research-open <ID>`

ARGUMENTS: {{ARG_SYNTAX}}
