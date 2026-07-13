---
description: Prioritise research <name> - assigns ID, moves to backlog
argument-hint: "<topic-name or letter>"
---
# aigon-research-prioritise

Run this command followed by the research topic name.

```bash
aigon research-prioritise $ARGUMENTS
```

## Argument Resolution

If no name is provided, or the name doesn't match an existing topic in the inbox:
1. List all files in `./docs/specs/research-topics/01-inbox/` matching `research-*.md`
2. If a partial name was given, filter to files containing that text
3. Present the matching topics and ask the user to choose one

This assigns or confirms the research ID, records backlog lifecycle state, and refreshes the generated view.

Next step: Run `aigon-research-start <ID>` (Drive) or `aigon-research-start <ID> cc gg` (Fleet) to begin.

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual ID assigned by the CLI:

`aigon-research-start <ID>`
