<!-- description: Create research <name> - creates topic in inbox -->
# aigon-research-create

Run this command followed by the research topic name.

```bash
aigon research-create {{ARG_SYNTAX}}
```

This creates a new research topic in `./docs/specs/research-topics/01-inbox/`.

> **Tip:** If you are running this command in your own Claude Code session (no `--agent` flag), press **Shift+Tab** now to enter plan mode before drafting — this keeps your session read-only while you frame the research brief.

## Important: Create the document only — do NOT conduct research

Your job is ONLY to create a research topic document. You are NOT researching, investigating, or answering questions. You are writing down what SHOULD be researched later by a different agent (or yourself in a later step).

**Do NOT:**
- Read source code to investigate the topic
- Search the web for answers
- Write findings, recommendations, or conclusions
- Fill in answers to the questions you define
- Explore the codebase beyond what's needed to phrase good questions

**Do:**
- Ask the user what they want to learn (if unclear from the topic name)
- Write a clear **Context** section explaining why this research matters
- Write focused **Questions to Answer** as a checklist (unchecked `- [ ]`)
- Define **Scope** (in scope / out of scope) to keep the research bounded
- Optionally note any **Inspiration** or starting-point references the user mentions

The output should be a short, well-structured document that frames the research — not the research itself. Think of it as a brief for another agent.

### Set the spec frontmatter (complexity)

The template ships with a `complexity:` frontmatter field that feeds the dashboard start modal's per-agent model/effort **defaults** (from each agent’s complexity ladder, then config). Pick:

- **low** — narrow topic, one dimension, answer already clear-ish (lookup research).
- **medium** — typical topic with 3–5 focused questions, moderate breadth.
- **high** — wide-ranging investigation, competing options with non-obvious trade-offs.
- **very-high** — exploratory research where the right *questions* aren't obvious yet. Reserve for research that needs strong reasoning.

Set `complexity:` in the frontmatter; do not write model or effort values into the spec — defaults are resolved at start time from each agent’s `cli.complexityDefaults[<complexity>]`.

Next step: Once the topic is complete, run `{{CMD_PREFIX}}research-prioritise {{ARG_SYNTAX}}` to assign an ID and move to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual topic name:

`{{CMD_PREFIX}}research-prioritise <name>`
