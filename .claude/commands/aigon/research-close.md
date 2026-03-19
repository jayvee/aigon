---
description: Close research <ID> - moves to done
argument-hint: "<ID>"
---
# aigon-research-close

Run this command followed by the Research ID.

```bash
aigon research-close {{args}} [--complete]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

This moves the research topic from `03-in-progress/` to `04-done/`.

## Usage

**Drive mode:** Run directly after completing your research findings.

**Fleet mode:**
- First run `/aigon-research-synthesize {ID}` to compare all agents' findings and select features
- The synthesize command will run `research-close --complete` automatically when finished

## Options

- `--complete` - Move directly to done (required for Fleet mode after synthesis)


ARGUMENTS: {{args}}
