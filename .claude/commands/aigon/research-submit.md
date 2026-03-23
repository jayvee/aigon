---
description: Submit research findings - signal completion for Fleet autopilot
---
# aigon-research-submit

Signal that your research findings are complete. Used in Fleet mode to let the autopilot monitor know you're done.

```bash
aigon research-submit {{args}} [agent]
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Your Task

Before running this command, ensure you have:

1. **Completed your research** — answered all questions in the research topic
2. **Written your findings** to your findings file:
   `docs/specs/research-topics/logs/research-{ID}-cc-findings.md`
3. **Included sources**: Links to references, documentation, and examples
4. **Written a recommendation**: Your recommended approach based on findings
5. **Suggested features**: Filled in the `## Suggested Features` table
6. **Committed your findings** to the worktree (if applicable)

## Submitting

Run the submit command to signal completion:

```bash
aigon research-submit {{args}}
```

This updates your findings file's status to `submitted`, which the `research-autopilot` monitor uses to detect completion.

## After Submitting

**STAY in the session.** The user may want to review your findings and ask follow-up questions.

Do NOT run `aigon research-close` — the user (or autopilot) will evaluate all agents' findings.

## Prompt Suggestion

End your response with the submitted confirmation. No further commands needed.

ARGUMENTS: {{args}}
