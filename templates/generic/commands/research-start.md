<!-- description: Start research <ID> - moves to in-progress -->
# aigon-research-start

Run this command followed by the Research ID.

```bash
aigon research-start {{ARG_SYNTAX}}
```

This moves the research topic from `02-backlog/` to `03-in-progress/`.

## Your Task

1. **Find the research topic** in `docs/specs/research-topics/03-in-progress/research-{ID}-*.md`

2. **Check for arena mode**: Look for your findings file at:
   `docs/specs/research-topics/logs/research-{ID}-{{AGENT_ID}}-findings.md`

3. **Conduct research** based on the questions and scope in the main research doc

4. **Document your findings**:
   - **If findings file exists (arena mode)**: Write ONLY to your findings file. Do not modify the main research doc or other agents' files.
   - **If no findings file (solo mode)**: Write directly to the `## Findings` section of the main research doc.

5. **Include sources**: Document links to references, documentation, and examples

6. **Write recommendation**: Provide your recommended approach based on findings

7. **Suggest specific features**: Fill in the `## Suggested Features` table with:
   - **Feature Name**: Use kebab-case, be specific (e.g., `user-auth-jwt` not `authentication`)
   - **Description**: One sentence explaining the capability
   - **Priority**: `high` (must-have), `medium` (should-have), `low` (nice-to-have)
   - **Depends On**: Other feature names this depends on, or `none`

## When You're Done

**If arena mode (findings file exists):**
- STOP after completing your findings file
- Do NOT run `aigon research-done`
- The user will run `research-done` to review all agents' findings and synthesize them
- Your task is complete once your findings file is filled in

**If solo mode (no findings file):**
- Run `aigon research-done {{ARG_SYNTAX}}` to complete the research


ARGUMENTS: {{ARG_SYNTAX}}
