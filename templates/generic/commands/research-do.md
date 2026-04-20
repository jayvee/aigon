<!-- description: Do research <ID> - agent writes findings -->
# aigon-research-do

Run this command followed by the Research ID.

```bash
aigon research-do {{ARG_SYNTAX}}
```

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

This command is the research equivalent of `feature-do`: it is the main work step after `research-start`.

## Step 0: Verify your workspace (MANDATORY)

Before doing ANYTHING else, verify your environment:

```bash
pwd
git branch --show-current
```

**Research agents work in the main repository on the current branch.** This is normal — research does not require branch isolation because you are only writing findings files, not modifying code.

**CRITICAL RULES for research:**
- You MUST NOT modify any source code files (`.js`, `.ts`, `.py`, `.json`, etc.)
- You MUST NOT modify other agents' findings files
- You MUST ONLY write to YOUR findings file: `docs/specs/research-topics/logs/research-{ID}-{{AGENT_ID}}-findings.md`
- You MUST NOT run `git checkout`, `git branch`, or create new branches — stay where you are

## Required Lifecycle Step

Before starting active research, run:

```bash
aigon agent-status implementing
```

This updates your agent state in the main repo so the dashboard and coordinator know you're actively working.

## Your Task

1. **Find the research topic** in `docs/specs/research-topics/03-in-progress/research-{ID}-*.md`

2. **Check for worktree/Fleet mode**: Look for your findings file at:
   `docs/specs/research-topics/logs/research-{ID}-{{AGENT_ID}}-findings.md`

3. **Conduct deep research** to answer each question in the research doc. Go broad before going deep:

   **How to research thoroughly:**
   - **Search the web** for documentation, blog posts, comparisons, and real-world usage. Don't rely only on what's in the codebase.
   - **Read primary sources** — official docs, GitHub repos, RFCs — not just summaries.
   - **Explore multiple approaches** before settling on one. For each question, consider at least 2-3 alternatives.
   - **Look at the codebase** to understand current patterns, constraints, and what's already been tried.
   - **Compare trade-offs** with evidence, not just intuition. Include concrete pros/cons.
   - **Cite your sources** — every claim should link back to where you found it.

   Spend the majority of your time here. Rushed research leads to shallow recommendations.
{{AGENT_TEAMS_RESEARCH_NOTE}}

4. **Document your findings**:
   - **If findings file exists (worktree/Fleet mode)**: Write ONLY to your findings file. Do not modify the main research doc or other agents' files.
   - **If no findings file (Drive mode)**: Write directly to the `## Findings` section of the main research doc.

5. **Include sources**: Document links to references, documentation, and examples

6. **Write recommendation**: Provide your recommended approach based on findings

7. **Suggest specific features**: Fill in the `## Suggested Features` table with:
   - **Feature Name**: Use kebab-case, be specific (e.g., `user-auth-jwt` not `authentication`)
   - **Description**: One sentence explaining the capability
   - **Priority**: `high` (must-have), `medium` (should-have), `low` (nice-to-have)
   - **Depends On**: Other feature names this depends on, or `none`

## When You're Done

**THIS IS THE FINAL STEP. YOU MUST COMPLETE IT. DO NOT SKIP THIS STEP.**

**If findings file exists (worktree/Fleet mode):**

1. **Verify you only modified your findings file:**
   ```bash
   git diff --name-only
   git diff --cached --name-only
   ```
   The ONLY file that should appear is `docs/specs/research-topics/logs/research-{ID}-{{AGENT_ID}}-findings.md`. If you see any other files, run `git checkout -- <file>` to discard those changes before committing.

2. **Commit your findings file (and ONLY your findings file):**
   ```bash
   git add docs/specs/research-topics/logs/research-*-{{AGENT_ID}}-findings.md
   git commit -m "docs: research findings for {{AGENT_ID}}"
   ```

3. **Signal completion immediately after the commit:**
   ```bash
   aigon agent-status submitted
   ```

   This command **must exit successfully** before you can claim your research is submitted.

   Hard rules:
   - Your findings are **not** submitted until `aigon agent-status submitted` returns exit 0
   - Do **not** say "done", "complete", "findings written", or "ready for review" before it exits 0
   - Do **not** summarise, narrate, or describe your output instead of running this command — the command IS the completion signal; prose is not a substitute
   - If it fails, report the exact error and stop for user guidance
   - **Do this even if you believe the user will run `research-eval` next.** That's a separate, later step — your submit signal is what unblocks it

4. **Post-submit (after `agent-status submitted` exits 0):** output one line — "Findings submitted — ready for evaluation." — and STAY in the session. Do NOT run `aigon research-close` or `aigon research-eval` — those are user decisions.

**If Drive mode (no findings file):**
- Run `aigon research-close {{ARG_SYNTAX}}` when the research pass is complete and ready to close

## Prompt Suggestion

If Drive mode, end your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual ID:

`{{CMD_PREFIX}}research-close <ID>`

ARGUMENTS: {{ARG_SYNTAX}}
