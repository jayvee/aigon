<!-- description: Complete research <ID> - moves to done -->
# aigon-research-done

Run this command followed by the Research ID.

```bash
aigon research-done {{ARG_SYNTAX}}
```

This moves the research topic from `03-in-progress/` to `04-done/`.

## IMPORTANT: Check for Arena Mode First

Before running this command, check if this is arena mode research:

**Look for findings files at:** `docs/specs/research-topics/logs/research-{ID}-*-findings.md`

**If findings files exist (arena mode):**
- **STOP - Do NOT run this command**
- Arena mode research has multiple agents contributing findings
- Only the USER should run `research-done` to synthesize all agents' findings
- Your task is complete once your findings file is filled in

**If no findings files exist (solo mode):**
- Ensure your research findings are documented in the main research doc
- Then run this command to complete the research


ARGUMENTS: {{ARG_SYNTAX}}
