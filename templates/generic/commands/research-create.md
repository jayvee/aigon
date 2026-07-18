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
- Read or explore the codebase even to phrase questions

**Do:**
- Ask the user what they want to learn (if unclear from the topic name)
- Write a clear **Context** section explaining why this research matters
- Write focused **Questions to Answer** as a checklist (unchecked `- [ ]`)
- Define **Scope** (in scope / out of scope) to keep the research bounded
- Optionally note any **Inspiration** or starting-point references the user mentions

The output should be a short, well-structured document that frames the research — not the research itself. Think of it as a brief for another agent.

## Deepen

**Framing only: do not read code, open or investigate references, search the web, or attempt to answer any research question. This rule overrides any instinct to investigate.** Your job in this step is only to sharpen the brief for a later research agent.

1. **Apply the gate.** Inspect the raw invocation arguments. If they contain `--quick`, skip Deepen and continue to writing the brief. Otherwise run `aigon config get deepen.enabled`; skip Deepen only when its effective value is `false`. Remember whether the command reported the built-in default so the final response can include the default-only hint below.
2. **Use only supplied framing.** Read the bare-bones brief, topic name, planning conversation, and the names or descriptions of user-provided references. Do not open those references. Build an internal coverage map in this order: **Context** (especially why now and what decision the work should inform) → **Questions to Answer** → **Scope** (in and out) → optional **Inspiration** → `complexity:`. Mark anything already resolved and do not ask it again.
3. **Ask the highest-leverage unresolved framing question.** Ask exactly one question per message and include a separate line in this form: `Recommended framing: ...`. The recommendation must be a framing choice the user can ratify or override, never a proposed research answer. Normally ask 2–5 questions. Never exceed 6 unless the user explicitly asks to continue, and stop earlier once every material section is draftable. Do not ask about Inspiration merely to fill the template.
4. **Maintain the brief as answers arrive.** Record ratifications and overrides. If the user says "I don't know" about a substantive answer, turn the unknown into a clear, non-duplicative unchecked item under **Questions to Answer**. If they do not know a framing preference, use the recommended framing and state that assumption visibly in the relevant **Context** or **Scope** prose; never invent a research answer. If the user says `enough`, `stop`, or an equivalent exit phrase, stop asking immediately and write the best brief supported by what you have.
5. **Keep questions researchable and useful.** Each question should be answerable, evidence-seeking, and relevant to a decision. For comparative or empirical questions, name the case, alternatives, and evidence or metric where applicable. For exploratory or qualitative questions, seek mechanisms, constraints, user needs, or failure modes; do not invent a metric merely to make a question look empirical.
6. **Finish the framing.** Write the brief, then infer `complexity:` last using the rubric below. In the final response, explain the chosen complexity in one sentence, but do not add a rationale section or rationale sentence to the research brief. If Deepen ran and `aigon config get deepen.enabled` reported the built-in default, also include exactly this concise hint: `Skip next time with --quick; disable everywhere with aigon config set --global deepen.enabled false.` Omit the hint when project or global configuration supplied the value.

### Set the spec frontmatter (complexity)

The template ships with a `complexity:` frontmatter field that feeds the dashboard start modal's per-agent defaults. Pick:

- **low** — narrow topic, one dimension, answer already clear-ish (lookup research).
- **medium** — typical topic with 3–5 focused questions, moderate breadth.
- **high** — wide-ranging investigation, competing options with non-obvious trade-offs.
- **very-high** — exploratory research where the right *questions* aren't obvious yet. Reserve for research that needs strong reasoning.

Set only `complexity:` in the frontmatter.

After the brief is final, promote durable framing decisions into the spec and
record the transcript-free author handoff. Derive identity with
`eval "$(aigon agent-context --shell)"`, then run
`aigon research-context record <ID> --file=<handoff.json>`. The JSON contains
the six arrays documented by `aigon-research-context`; never copy provider
session IDs or transcript paths manually.

Next step: Once the topic is complete, run `{{CMD_PREFIX}}research-prioritise {{ARG_SYNTAX}}` to assign an ID and prioritise it to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual topic name:

`{{CMD_PREFIX}}research-prioritise <name>`
