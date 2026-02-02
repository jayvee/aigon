<!-- description: Conduct research <ID> - agent writes findings -->
# aigon-research-conduct

Run this command followed by the Research ID.

```bash
aigon research-conduct {{ARG_SYNTAX}}
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

This command is for agents to conduct research after setup is complete.

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
