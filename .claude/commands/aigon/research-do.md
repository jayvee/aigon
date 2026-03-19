---
description: Do research <ID> - agent writes findings
argument-hint: "<ID>"
---
# aigon-research-do

Run this command followed by the Research ID.

```bash
aigon research-do {{args}}
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

This command is for agents to conduct research after setup is complete.

## Your Task

1. **Find the research topic** in `docs/specs/research-topics/03-in-progress/research-{ID}-*.md`

2. **Check for Fleet mode**: Look for your findings file at:
   `docs/specs/research-topics/logs/research-{ID}-cc-findings.md`

3. **Conduct deep research** to answer each question in the research doc. Go broad before going deep:

   **How to research thoroughly:**
   - **Search the web** for documentation, blog posts, comparisons, and real-world usage. Don't rely only on what's in the codebase.
   - **Read primary sources** — official docs, GitHub repos, RFCs — not just summaries.
   - **Explore multiple approaches** before settling on one. For each question, consider at least 2-3 alternatives.
   - **Look at the codebase** to understand current patterns, constraints, and what's already been tried.
   - **Compare trade-offs** with evidence, not just intuition. Include concrete pros/cons.
   - **Cite your sources** — every claim should link back to where you found it.

   Spend the majority of your time here. Rushed research leads to shallow recommendations.

### Agent Teams (optional)

For complex research topics with multiple questions, consider creating an agent team. Spawn teammates to investigate different questions in parallel with adversarial debate — have them challenge each other's findings. Use delegate mode so you coordinate without researching yourself. Reference: https://code.claude.com/docs/en/agent-teams


4. **Document your findings**:
   - **If findings file exists (Fleet mode)**: Write ONLY to your findings file. Do not modify the main research doc or other agents' files.
   - **If no findings file (Drive mode)**: Write directly to the `## Findings` section of the main research doc.

5. **Include sources**: Document links to references, documentation, and examples

6. **Write recommendation**: Provide your recommended approach based on findings

7. **Suggest specific features**: Fill in the `## Suggested Features` table with:
   - **Feature Name**: Use kebab-case, be specific (e.g., `user-auth-jwt` not `authentication`)
   - **Description**: One sentence explaining the capability
   - **Priority**: `high` (must-have), `medium` (should-have), `low` (nice-to-have)
   - **Depends On**: Other feature names this depends on, or `none`

## When You're Done

**If Fleet mode (findings file exists):**
1. **Open your findings file** so the user can read along as you summarize:
   ```bash
   open docs/specs/research-topics/logs/research-{ID}-cc-findings.md
   ```

2. **Briefly summarize your top findings and recommendation** to the user in chat.

3. **STOP** — do NOT run `aigon research-close`. The user will synthesize all agents' findings.

**If Drive mode (no findings file):**
- Run `aigon research-close {{args}}` to complete the research

## Prompt Suggestion

If Drive mode, end your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual ID:

`/aigon:research-close <ID>`

ARGUMENTS: {{args}}
