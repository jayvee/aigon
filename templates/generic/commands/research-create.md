<!-- description: Create research <name> - creates topic in inbox -->
# aigon-research-create

Run this command followed by the research topic name.

```bash
aigon research-create {{ARG_SYNTAX}}
```

This creates a new research topic in `./docs/specs/research-topics/01-inbox/`.

## Before writing the research topic

Explore the codebase to understand the current state of the area under research. Plan your approach before writing. Consider:

- What existing code or patterns are relevant to this research?
- What has already been tried or decided in this area?
- What specific gaps in understanding need to be filled?

Use this understanding to write focused **Questions to Answer** and well-defined **Scope** sections.

Next step: Once the topic is complete, run `{{CMD_PREFIX}}research-prioritise {{ARG_SYNTAX}}` to assign an ID and move to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual topic name:

`{{CMD_PREFIX}}research-prioritise <name>`
