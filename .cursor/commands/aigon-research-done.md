# aigon-research-done

Run this command followed by the Research ID.

```bash
aigon research-done <args> [--complete]
```

This moves the research topic from `03-in-progress/` to `04-done/`.

## Usage

**Solo mode:** Run directly after completing your research findings.

**Arena mode:**
- First run `/aigon-research-synthesize {ID}` to compare all agents' findings and select features
- The synthesize command will run `research-done --complete` automatically when finished

## Options

- `--complete` - Move directly to done (required for arena mode after synthesis)


ARGUMENTS: <args>
