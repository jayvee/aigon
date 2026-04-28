# Research Findings: guided entity creation

**Agent:** Codex (cx)
**Research ID:** 46
**Date:** 2026-04-28

---

## Key Findings

### 1. What Matt Pocock's `/grill-me` appears to do

The public source is the `grill-me/SKILL.md` in `mattpocock/skills`. Its instructions are short but very specific:

- Interview the user relentlessly about a plan or design until shared understanding is reached.
- Walk down each branch of the design tree and resolve dependencies one-by-one.
- For each question, provide a recommended answer.
- Ask the questions one at a time.
- If a question can be answered by exploring the codebase, explore the codebase instead.

That combination is the important bit. `/grill-me` is not just "ask clarifying questions". It is a directed interrogation loop with:

- serial questioning rather than a big batch
- explicit dependency traversal
- model-supplied recommendations, not just neutral prompts
- a bias toward replacing user questions with repo exploration when the answer is already discoverable

### 2. Why this pattern works

The effectiveness seems to come from stacking several good elicitation properties at once:

| Design choice | Why it helps | Risk |
|---|---|---|
| One question at a time | Reduces cognitive load and lets each answer steer the next branch | Can feel slow if the model asks obvious questions |
| Decision-tree traversal | Forces unresolved dependencies into the open | Can over-structure fuzzy discovery |
| "Recommend an answer" | Gives the user something concrete to react to, which is easier than authoring from scratch | Can become leading if the recommendation is too strong |
| "Explore the codebase instead" | Avoids wasting turns on facts the agent can discover locally | Only works when exploration is actually cheap and reliable |

Anthropic's own tool-design writeup points in the same direction: they built `AskUserQuestion` because plain-text elicitation felt unnecessarily slow, and the dedicated tool improved structured questioning and user response flow. OpenAI's deep-research cookbook independently recommends asking only the 3-6 most ambiguity-reducing questions, surfacing missing critical dimensions explicitly, and avoiding invented preferences. So the broad pattern is not unique to Matt's skill; his skill is a crisp productized version of it.

### 3. What Aigon already has

Aigon already has an interactive drafting path behind `--agent` for both create commands:

- `templates/prompts/feature-draft.md`
- `templates/prompts/research-draft.md`

Those prompts already tell the agent to:

- read the bare spec
- ask clarifying questions
- show proposed sections in chat before writing
- iterate section-by-section

What they do **not** currently specify:

- one-question-at-a-time
- explicit stop conditions
- different questioning modes for feature vs research
- any "answer from codebase instead of asking" heuristic
- any rule for how to handle "I don't know" without stalling

So Aigon is already adjacent to `/grill-me`, but the current prompts are still generic collaborative drafting prompts, not a strong elicitation workflow.

### 4. Relevant elicitation techniques and what they are good for

#### Structured interviewing

**5 Whys**

- Good for drilling into a stated pain, root cause, or "why does this matter?"
- Best used narrowly, after a problem statement exists
- Weak as the main create flow because it optimizes for causal diagnosis, not spec completeness

**W6H / interrogative ordering**

- Academic RE work argues that the order and dependency of question types matters, and that adding `which` to the classic W5H set improves elicitation and analysis
- Useful as a hidden scaffold for the agent: identity/context first, then constraints, then choices, then success/failure conditions

#### Product-discovery frameworks

**JTBD**

- Best for understanding the underlying job, success metrics, and competing alternatives
- Particularly valuable for `research-create`, where the user's first instinct may be a solution rather than the real question

**The Mom Test**

- Strong anti-bias rules: ask about concrete past behavior, not hypothetical future preferences
- Helps the agent avoid leading questions like "would you use X?" and instead ask "what do you do today when Y happens?"

**Lean Canvas prompts**

- Useful for quickly surfacing assumptions: problem, alternatives, users, value, metrics, risks
- Better as a coverage checklist than as the visible conversation format

#### Agile story refinement

**INVEST**

- Good for checking whether a drafted feature is small/testable/valuable enough
- Not a questioning method by itself; better as a late-stage validation rubric

**Gherkin / BDD**

- Good for turning clarified behavior into testable acceptance scenarios
- The literature is clear that BDD artifacts depend on already-clear requirements; they do not replace elicitation
- Useful for `feature-create` exit criteria, not for early discovery

#### LLM-native patterns

**Ask clarifying questions before answering**

- Broadly effective when the initial prompt is underspecified
- Official guidance from OpenAI and Anthropic supports scoped clarification before execution

**Structured question tools**

- Anthropic's `AskUserQuestion` shows there is real UX value in reducing friction around the question loop
- This matters if Aigon ever moves beyond plain text prompts into richer frontends or agent integrations

### 5. What has evidence vs what is mostly folklore

#### Better supported

- **Structured elicitation beats fully unstructured interviewing.** A family of experiments comparing JAD, paper prototyping, and unstructured interviews found unstructured interviews were fastest but lowest quality, while paper prototyping had the best completeness, quality, and performance.
- **Question ordering and interrogative coverage matter.** The W6H paper gives a requirements-specific rationale for structuring question types rather than improvising them.
- **LLM assistance can improve requirement articulation.** A 2026 empirical study found participants rated LLM-revised requirement statements higher than their own originals on alignment, readability, reasoning, and unambiguity.
- **Clarification-seeking helps underspecified coding tasks.** A 2026 coding-agent paper improved resolve rate from 61.2% to 69.4% on an underspecified SWE-bench variant by explicitly separating uncertainty detection from execution.
- **LLM interviewers are plausible but imperfect.** `LLMREI` found an LLM interviewer could extract a large portion of requirements and ask context-dependent questions with error rates similar to human interviewers in simulated interviews.

#### Mostly practitioner heuristics

- **`/grill-me` itself.** Publicly visible and widely copied, but evidence is anecdotal.
- **The Mom Test, JTBD interviews, Lean Canvas, INVEST.** These are strong practitioner frameworks with lots of adoption, but I did not find comparable empirical evidence tying them directly to better software-spec artifacts in the way the RE interview studies do.
- **Gherkin as an elicitation tool.** There is evidence around BDD artifact quality and maintenance, but the strongest source I found explicitly says BDD is not a requirements-elicitation technique and should be combined with other methods such as prototyping.

### 6. Failure modes of guided Q&A

- **Interrogation fatigue.** One-question-at-a-time is effective, but if the agent asks too many shallow questions, the user will bail.
- **Leading questions.** "Recommended answers" are powerful, but they can smuggle the model's assumptions into the spec.
- **Asking what the repo can answer.** For feature work, unnecessary questions are wasted turns; the agent should inspect the codebase first when the answer is discoverable.
- **Blocking users who want speed.** Some create flows should be "good enough in 3 questions", not "full interview every time".
- **Research-mode mismatch.** Research users often genuinely do not know the answer. If the agent treats uncertainty as failure, the flow becomes hostile.
- **No clear stop rule.** Without an explicit exit condition, the model keeps asking because there is always one more question.

### 7. How the flow should differ by entity type

#### `research-create`

Primary goal: sharpen the question, not converge on a solution.

The agent should emphasize:

- what decision this research is meant to inform
- what is already known vs unknown
- competing hypotheses or approaches worth investigating
- what "useful research output" would look like
- bounded scope and explicit out-of-scope

Allowed user response patterns should include:

- "I don't know"
- "that's what I want the research to find out"
- "give me plausible options"

So the agent should behave more like a discovery interviewer and less like a PRD finisher.

#### `feature-create`

Primary goal: convert intent into a buildable, testable spec.

The agent should emphasize:

- user/system behavior
- constraints and integrations
- success/failure paths
- acceptance criteria and edge cases
- evidence from the existing codebase before asking the user

This is much closer to `/grill-me`: more dependency resolution, more concrete recommendations, and earlier transition into crisp acceptance language.

### 8. Recommended exit condition

Do **not** use fixed N.

Use a hybrid stop rule:

1. The model maintains an internal coverage checklist for the target spec sections.
2. After each answer, it decides whether any unanswered section is still materially ambiguous.
3. It stops when either:
   - all required sections are answerable at draft quality, or
   - the user says "enough", "draft it", or equivalent.
4. Before writing, it produces a brief synthesis of current assumptions and any remaining open questions.

For `feature-create`, a good hidden checklist is:

- goal / user value
- actors
- current behavior / relevant existing system behavior
- desired behavior
- constraints / dependencies
- acceptance criteria
- edge cases
- complexity estimate

For `research-create`, a good hidden checklist is:

- motivation / decision to inform
- current uncertainty
- key questions
- scope boundaries
- what a useful recommendation would need to cover
- complexity estimate

### 9. Fit with existing Aigon constraints

- This should stay **non-investigative during create**. The research brief explicitly says create commands should not read code or search the web. That means the "explore instead of asking" trick from `/grill-me` is a clean fit for `feature-create --agent` today, but **not** for the plain create command as currently defined.
- `feature-spec-review` and `research-spec-review` should remain downstream quality gates. Guided create reduces thin specs; it does not remove the need for review.
- `complexity:` should still be set during create. The agent can infer a provisional complexity late in the conversation and explain the choice in one sentence.
- Existing `--agent` draft flow is the natural insertion point because it already supports multi-turn collaboration without changing command semantics for bare non-agent usage.

### 10. Minimum viable change vs ambitious version

#### Minimum viable change

Keep the current command surface. Change only the two draft prompts used by `--agent`.

For both prompts:

- require one question at a time
- tell the model to prefer the smallest next question that most reduces ambiguity
- allow the user to answer "I don't know" or "give options"
- maintain a hidden section-coverage checklist
- stop once the checklist is satisfied or the user says to draft
- summarize assumptions before writing

Entity-specific tweaks:

- `feature-draft.md`: prefer repo-derived answers when the prompt already allows reading the spec file and relevant repo context is available in-session
- `research-draft.md`: forbid forcing answers the user does not know; convert unknowns into explicit research questions

This is low-risk, incremental, and directly compatible with the current `--agent` feature.

#### More ambitious version

Add explicit workflow modes:

- `aigon feature-create --agent <id>` stays collaborative drafting
- `aigon feature-create --guided --agent <id>` turns on strict one-question-at-a-time elicitation
- `aigon research-create --guided --agent <id>` uses a research-specific discovery script

Or make guided mode the default when `--agent` is used, with `--unguided` as escape hatch.

This is stronger product design, but it changes user expectations and needs more prompt testing.

### 11. Is a standalone `/grill-me`-style command worth adding?

Yes, but **not instead of** improving create.

There are two distinct jobs here:

- **Create-time elicitation:** turn a thin initial request into a decent first spec.
- **Post-hoc deepening:** interrogate an existing spec to surface missing assumptions, contradictions, or weak acceptance criteria.

The second deserves its own command because it maps to a different user intent and can safely operate after a first draft exists. In Aigon terms, it looks more like a pre-review spec-deepening pass than a replacement for create.

My recommendation is:

- improve `--agent` create prompts first
- later add a standalone deepen-spec command for existing specs

That sequencing gives immediate value with low implementation risk and avoids prematurely expanding the command surface.

## Sources

- Matt Pocock `grill-me` public skill: https://github.com/mattpocock/skills/blob/main/grill-me/SKILL.md
- Anthropic, "Seeing like an agent: how we design tools in Claude Code" (`AskUserQuestion` rationale): https://claude.com/blog/seeing-like-an-agent
- Anthropic Claude Code docs, skills and slash commands: https://code.claude.com/docs/en/slash-commands
- Anthropic Claude Code docs, handling user input / `AskUserQuestion`: https://code.claude.com/docs/en/agent-sdk/user-input
- OpenAI cookbook, deep research clarification prompt pattern: https://developers.openai.com/cookbook/examples/deep_research_api/introduction_to_deep_research_api
- OpenAI Model Spec, clarifying questions in interactive settings: https://openai.com/index/introducing-the-model-spec/
- Bano et al., "Requirements elicitation methods based on interviews in comparison: A family of experiments": https://www.sciencedirect.com/science/article/pii/S0950584920301282
- Ghaisas et al., "Ordering Interrogative Questions for Effective Requirements Engineering: The W6H Pattern": https://arxiv.org/abs/1508.01954
- Mircea et al., "Supporting Stakeholder Requirements Expression with LLM Revisions: An Empirical Evaluation": https://arxiv.org/abs/2601.16699
- "Ask or Assume? Uncertainty-Aware Clarification-Seeking in Coding Agents": https://arxiv.org/abs/2603.26233
- Korn et al., "LLMREI: Automating Requirements Elicitation Interviews with LLMs": https://arxiv.org/abs/2507.02564
- Lean Enterprise Institute, `5 Whys`: https://www.lean.org/lexicon-terms/5-whys/
- Lean Enterprise Institute, "Clarifying the '5 Whys' Problem-Solving Method": https://www.lean.org/the-lean-post/articles/five-whys-animation/
- Bill Wake, original `INVEST` article: https://xp123.com/invest-in-good-stories-and-smart-tasks/
- Cucumber Gherkin reference: https://cucumber.io/docs/gherkin/reference/
- BDD in practice PhD thesis with limits of Gherkin for elicitation: https://theses.gla.ac.uk/84085/1/2024IslamPhD.pdf
- Strategyn, JTBD / ODI overview: https://strategyn.com/jobs-to-be-done/
- Ash Maurya on Lean Canvas: https://www.leanfoundry.com/articles/what-is-lean-canvas
- The Mom Test official site: https://www.momtestbook.com/
- Local Aigon prompts already used for interactive drafting: `templates/prompts/feature-draft.md`, `templates/prompts/research-draft.md`

## Recommendation

Adopt guided elicitation as the default behavior for the existing `--agent` create flow, not for bare create, and do it with **entity-specific prompts** rather than a single generic `/grill-me` transplant.

Concretely:

1. Upgrade `templates/prompts/feature-draft.md` and `templates/prompts/research-draft.md` so they behave like a disciplined elicitation loop:
   - one question at a time
   - smallest next question that most reduces ambiguity
   - coverage-based stop rule
   - brief assumption summary before writing
   - explicit handling for "I don't know" / "give options"

2. Make the two prompts deliberately different:
   - `feature-create --agent`: more like `/grill-me`, including recommendation-heavy questioning and stronger convergence toward acceptance criteria
   - `research-create --agent`: more exploratory, less leading, and explicitly allowed to convert uncertainty into research questions rather than force answers

3. Keep `feature-spec-review` / `research-spec-review` as the downstream improvement step. Guided create should improve first-draft quality, not replace review.

4. After that lands, add a **separate** deepen-existing-spec command if the team still wants a true `/grill-me` equivalent for already-written specs.

This is the best tradeoff because it:

- uses the workflow Aigon already has
- minimizes command-surface churn
- preserves current non-agent create behavior
- fits the "create should not research" rule
- gives immediate benefit to the users already opting into collaborative drafting

The strongest counterargument is making guided mode the default for all create paths. I would not do that first. The failure mode is over-interrogating users who wanted a quick spec stub. Start with `--agent`, observe quality and drop-off, then decide whether a `--guided` flag or default-on behavior is warranted.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| guided-create-prompts | Rewrite the `feature-draft` and `research-draft` prompts to enforce one-question-at-a-time elicitation, coverage-based stopping, and assumption summaries before writing. | high | none |
| entity-specific-elicitation-modes | Give feature-create and research-create different questioning heuristics so feature drafting converges on implementation detail while research drafting preserves uncertainty as explicit questions. | high | guided-create-prompts |
| guided-create-flag | Add an explicit `--guided` mode for create commands so users can opt into a stricter interrogation workflow without changing bare create behavior. | medium | guided-create-prompts |
| spec-deepen-command | Add a standalone `/grill-me`-style command for interrogating an existing spec and surfacing missing assumptions before spec review. | medium | entity-specific-elicitation-modes |
| complexity-inference-on-create | Infer and explain a provisional `complexity:` label at the end of guided create so the frontmatter is set consistently from elicited scope. | medium | guided-create-prompts |
| elicitation-transcript-to-spec-log | Persist a compact summary of the guided Q&A decisions into the spec or implementation log so later agents can see why the spec was framed that way. | low | guided-create-prompts |
