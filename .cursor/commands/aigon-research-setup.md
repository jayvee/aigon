# aigon-research-setup

Prepare to conduct research in either solo or arena mode.

## Usage

```bash
# Solo mode (single agent)
aigon research-setup <name>

# Arena mode (multiple agents)
aigon research-setup <name> <agent1> <agent2> [agent3...]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in the backlog:
1. List all files in `./docs/specs/research-topics/02-backlog/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

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
/aigon-research-conduct 05     # Conduct the research
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
1. Run each agent with `/aigon-research-conduct 05`
2. Each agent writes to their own findings file
3. After all agents complete, run `aigon research-done 05` to synthesize

## Important Notes

- **Solo mode**: Agent writes findings directly to the main research doc
- **Arena mode**: Each agent writes ONLY to their own findings file
- Arena mode requires at least 2 agents
- Findings files are created in `docs/specs/research-topics/logs/`


ARGUMENTS: <args>
