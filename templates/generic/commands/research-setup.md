<!-- description: Setup research <ID> [agents...] - prepare for solo or arena mode -->
# aigon-research-setup

Prepare to conduct research in either solo or arena mode.

## Usage

```bash
# Solo mode (single agent)
aigon research-setup {{ARG1_SYNTAX}}

# Arena mode (multiple agents)
aigon research-setup {{ARG1_SYNTAX}} <agent1> <agent2> [agent3...]
```

## Mode Selection

The mode is determined automatically based on parameters:
- **No agents**: Solo mode - one agent researches the topic
- **2+ agents**: Arena mode - multiple agents research in parallel

## Solo Mode

Sets up for a single agent to research the topic.

Example:
```bash
aigon research-setup 05
```

This will:
- Move topic to in-progress

Next steps:
```bash
{{CMD_PREFIX}}research-conduct 05     # Conduct the research
```

## Arena Mode

Sets up for multiple agents to research the same topic in parallel.

Example:
```bash
aigon research-setup 05 cc gg
```

This will:
- Move topic to in-progress
- Create findings files for each agent:
  - `logs/research-05-cc-findings.md` (Claude)
  - `logs/research-05-gg-findings.md` (Gemini)

Next steps:
1. Run each agent with `{{CMD_PREFIX}}research-conduct 05`
2. Each agent writes to their own findings file
3. After all agents complete, run `aigon research-done 05` to synthesize

## Important Notes

- **Solo mode**: Agent writes findings directly to the main research doc
- **Arena mode**: Each agent writes ONLY to their own findings file
- Arena mode requires at least 2 agents
- Findings files are created in `docs/specs/research-topics/logs/`


ARGUMENTS: {{ARG_SYNTAX}}
