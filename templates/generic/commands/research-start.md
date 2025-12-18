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

7. **Suggest specific features**: Based on your findings, suggest concrete features that should be created. Include:
   - Feature names (suitable for `aigon feature-create`)
   - Brief description of what each feature would accomplish
   - Priority order if multiple features are suggested
   - Dependencies between features if any

When done: Run `aigon research-done {{ARG_SYNTAX}}`


ARGUMENTS: {{ARG_SYNTAX}}
