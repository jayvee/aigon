<!-- description: Complete research <ID> - moves to done -->
# aigon-research-done

Run this command followed by the Research ID.

```bash
aigon research-done {{ARG_SYNTAX}} [--complete]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

This moves the research topic from `03-in-progress/` to `04-done/`.

## Usage

**Solo mode:** Run directly after completing your research findings.

**Arena mode:**
- First run `/aigon-research-synthesize {ID}` to compare all agents' findings and select features
- The synthesize command will run `research-done --complete` automatically when finished

## Options

- `--complete` - Move directly to done (required for arena mode after synthesis)


ARGUMENTS: {{ARG_SYNTAX}}
