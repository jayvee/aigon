# aigon-research-prioritise

Run this command followed by the research topic name.

```bash
aigon research-prioritise <args>
```

## Argument Resolution

If no name is provided, or the name doesn't match an existing topic in the inbox:
1. List all files in `./docs/specs/research-topics/01-inbox/` matching `research-*.md`
2. If a partial name was given, filter to files containing that text
3. Present the matching topics and ask the user to choose one

This assigns an ID to the research topic and moves it from `01-inbox/` to `02-backlog/`.

Next step: Run `/aigon-research-setup <ID>` (solo) or `/aigon-research-setup <ID> cc gg` (arena) to begin.
