# Research Findings: guided entity creation

**Agent:** Claude (cc)
**Research ID:** 46
**Date:** 2026-04-29

---

## Key Findings

### 1. Matt Pocock's `/grill-me` — verbatim prompt

The skill lives in [mattpocock/skills](https://github.com/mattpocock/skills) at `skills/productivity/grill-me/SKILL.md`. It is short, opinionated, and the entire prompt is:

```md
---
name: grill-me
description: Interview the user relentlessly about a plan or design until reaching shared understanding, resolving each branch of the decision tree. Use when user wants to stress-test a plan, get grilled on their design, or mentions "grill me".
---

Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer.

Ask the questions one at a time.

If a question can be answered by exploring the codebase, explore the codebase instead.
```

The repo went from zero to ~22K stars in 24 hours, which is the social proof — but the prompt itself is the artifact worth studying.

### 2. Why `/grill-me` works — five design choices, ranked by leverage

1. **One question at a time.** Hard rule, in the prompt body. Eliminates the "wall of bullets" failure that turns elicitation into a form-filling chore. The user answers what is in front of them and the model picks the next branch.
2. **Recommended answer attached to every question.** Pocock added this after the first version and says it "speeds up the conversation significantly" — most user replies become "yes" / "no, do X instead." This converts interrogation from interview-style to *ratification-style*. Cognitively cheap; the model does the thinking, the user adjudicates.
3. **Decision-tree traversal, not flat checklist.** "Walk down each branch... resolving dependencies between decisions one-by-one." The model orders questions so upstream decisions land before downstream ones. A flat checklist would force the user to make every decision in template order, which is wrong order most of the time.
4. **Investigate before asking.** "If a question can be answered by exploring the codebase, explore the codebase instead." Removes dumb questions whose answers are already in the repo. **This directly conflicts with the existing aigon `research-create` and `feature-create` rules**, which forbid investigation. See § "Aigon-specific tension" below — it's the most important design call to make.
5. **Adversarial framing — "relentlessly," "grilled."** Sets user expectations. The user opted in to being challenged; the model is licensed to push back. Avoids the polite-LLM failure where it accepts vague answers and produces a vague spec.

What `/grill-me` notably does **not** specify: a stop condition, a maximum question count, a "don't know" handler, or a final summary. Pocock says sessions "often last about 45 minutes and end with a summary" — but that behaviour is emergent from the framing, not encoded.

### 3. Other patterns worth knowing

- **GitHub `spec-kit` `/clarify` (`/speckit.clarify`).** Same problem, opposite spirit. Surfaces ambiguities as **multiple-choice options** rather than open prose, bounded to a single phase between `/specify` and `/plan`. Counterpoint: bounded, structured, fast — at the cost of grill-me's adaptive depth.
- **OpenAI cookbook ("interview mode").** Budgeted variant: ask only when missing info would materially change the answer; **3–6 highest-leverage questions**, bulleted. The hard cap is the whole point.
- **Anthropic's `AskUserQuestionTool` pattern.** Clarification as a tool call the agent decides to invoke. Different ergonomics — the agent picks when to interrupt rather than running an entire interview phase up front.
- **The Mom Test (Rob Fitzpatrick).** Ask about specific past behaviour, not hypothetical futures. Translates to: "Show me the spec you would have written without help" rather than "What would the ideal spec look like?". Useful framing for the *first* question in a guided flow.
- **5 Whys / Socratic / JTBD / INVEST + Gherkin.** Off-the-shelf elicitation frames. None LLM-native, but each maps onto a prompt scaffold. Gherkin "given/when/then" is the closest fit to feature-template's Acceptance Criteria section.

### 4. Evidence vs folklore

Most claims that elicitation improves spec quality are **practitioner folklore** — Pocock's testimonials, blog posts, the viral repo. The closest things to evidence:

- ["Modeling Future Conversation Turns to Teach LLMs to Ask Clarifying Questions" (arXiv 2410.13788)](https://arxiv.org/html/2410.13788v2) — reward-modelling clarification as a double-turn improves QA performance over single-turn baselines.
- [ClarQ-LLM (arXiv 2409.06097)](https://arxiv.org/html/2409.06097v1) — even GPT-4o (50.8%) and LLAMA3.1-405B (60.5%) underperform humans (85%) at deciding *when* and *what* to ask. So: clarification helps when done well, but frontier models are still only mediocre at it unsupervised. **Implication for us: the prompt must do work the model wouldn't do on its own.**
- [Conversational User-AI Intervention (arXiv 2503.16789)](https://arxiv.org/html/2503.16789v1) — clarification interventions improve response quality on user studies.

No specifically-on-spec-quality RCT exists. Treat grill-me's effectiveness as well-evidenced practitioner consensus, not RCT-grade.

### 5. Failure modes (and which ones bite us)

| Failure | Mitigation | Bites Aigon? |
|---|---|---|
| Interrogation fatigue / wall-of-text | One question at a time; checkpoints | Yes — the user creates many specs. A 45-min grill is wrong for a 30-second feature-create. |
| Leading questions ("you want X, right?") | Label recommendations explicitly; allow free-text override | Mild — recommended answers are good *if* labelled |
| Repetition / forgetting prior answers | Periodic summarise-and-confirm | Mild — sessions are short |
| "I don't know" answers | Model offers a default and flags assumption | **Severe for research-create** — the user genuinely doesn't know. That's why it's research. |
| Blocking when user wants to move fast | Hard "stop" exit; bounded budget | Yes — directly conflicts with `feature-now` fast-track flow |
| Scope drift into investigation | Bound to "answer the template," not "design the feature" | **Yes** — see § 6 |

### 6. Aigon-specific tension: investigation vs. the create-step rule

Both `aigon-research-create.md` and `aigon-feature-create.md` enforce: **do not investigate the codebase, do not search the web, do not write findings.** `feature-create` does permit *limited* exploration to inform Technical Approach; `research-create` forbids it entirely.

`/grill-me`'s rule "if a question can be answered by exploring the codebase, explore it instead" is **the single highest-leverage design choice in the prompt**, and we cannot adopt it verbatim for `research-create` without breaking the existing contract — research-create is supposed to be a pure framing step that produces a brief for a *later* agent.

The two flows therefore need different elicitation rules:

- **feature-create** can adopt grill-me's investigate-first rule almost verbatim. Already permitted to read code; this is just an upgrade in how it elicits.
- **research-create** must keep the no-investigation rule. Elicitation here is **framing-only** — questions only about scope, motivation, and what counts as "good enough to stop researching." The model never tries to *answer* the research questions during create.

### 7. Right exit condition per entity type

- **feature-create**: "every required template section has a non-vague answer the user has confirmed." Not a fixed N. The model checks the spec template's required fields (Summary, User Stories, Acceptance Criteria, Technical Approach, Dependencies, Out of Scope, complexity frontmatter) and stops when each has a concrete, ratified value. Plus a hard user-side `enough` / `stop` exit.
- **research-create**: "the brief is well-framed enough that a future agent could research without coming back to ask." That means: Context establishes *why now*, Questions are falsifiable (not "is X good?" but "for case Y, does X beat Z by metric W?"), Scope is bounded, complexity is set. Typically 4–7 questions; never investigation.

### 8. Interaction with downstream review

`feature-spec-review` and `research-spec-review` already exist as the post-hoc improvement path. Guided creation does **not** replace them — it raises the floor of what enters review, so review can spend its budget on judgment calls rather than re-eliciting basics. Important consequence: don't add investigation/research output to the create step "because the model can"; that's review's job.

Also: complexity frontmatter must remain explicit, because per-agent model/effort defaults resolve from it (`cli.complexityDefaults[<complexity>]`). The guided flow must **always** end by setting `complexity:` and never invent model/effort values.

## Sources

- [mattpocock/skills repo](https://github.com/mattpocock/skills)
- [grill-me SKILL.md (verbatim prompt)](https://github.com/mattpocock/skills/blob/main/skills/productivity/grill-me/SKILL.md)
- [aihero.dev — My 'Grill Me' Skill Went Viral](https://www.aihero.dev/my-grill-me-skill-has-gone-viral)
- [github/spec-kit](https://github.com/github/spec-kit)
- [OpenAI GPT-5 prompting guide](https://developers.openai.com/cookbook/examples/gpt-5/gpt-5_prompting_guide)
- [OpenAI Deep Research API intro](https://developers.openai.com/cookbook/examples/deep_research_api/introduction_to_deep_research_api)
- [Anthropic — Writing tools for agents](https://www.anthropic.com/engineering/writing-tools-for-agents)
- [Spring AI — AskUserQuestionTool](https://spring.io/blog/2026/01/16/spring-ai-ask-user-question-tool/)
- [The Mom Test](https://www.momtestbook.com)
- [arXiv 2410.13788 — Teaching LLMs to ask clarifying questions](https://arxiv.org/html/2410.13788v2)
- [arXiv 2409.06097 — ClarQ-LLM](https://arxiv.org/html/2409.06097v1)
- [arXiv 2503.16789 — Conversational User-AI Intervention](https://arxiv.org/html/2503.16789v1)
- [NN/g — AI chatbots discourage error checking](https://www.nngroup.com/articles/ai-chatbots-discourage-error-checking/)
- [Frontiers — Suggestive answers strategy](https://www.frontiersin.org/journals/psychology/articles/10.3389/fpsyg.2024.1382234/full)

## Recommendation

**Bake guided elicitation into both create commands by default, with two distinct prompt variants and a single `--no-grill` opt-out for the fast path.** Do not build it as a separate slash command, and do not gate it behind `--guided`.

Why this option, not the others:

- **Bake-in (default-on)** wins because the whole problem is that thin specs *already happen by default*. An opt-in flag is a flag nobody types — the bad path stays the dominant path. The only people who currently produce good specs in one shot are the ones who already know what they're doing; a default-on guided flow does not slow them down (they answer "yes" to recommendations and the session ends in a minute) but it does meaningfully lift everyone else.
- **Separate `/grill` command operating on existing specs** — *also build this, but as a follow-on*. It is genuinely useful for deepening older specs and for teams that want grill-on-demand. But it does not replace baking in at create, because by the time a thin spec is committed it has already incurred the downstream cost (review cycles, wrong implementations).
- **`--guided` opt-in flag** — rejected. Same defaults problem. The one population for whom default-on is wrong is `feature-now` fast-track; that path should pass `--no-grill` (or its equivalent) explicitly.

### What changes

**`templates/generic/commands/aigon-feature-create.md` — add a guided-elicitation block** that (paraphrasing grill-me directly):

> Before writing the spec, interview the user one question at a time. For each question provide your recommended answer based on the codebase. Walk down the spec template top-to-bottom, resolving upstream decisions (Summary, User Stories) before downstream ones (Acceptance Criteria, Technical Approach). If a question can be answered by reading the codebase, read it instead of asking. Stop when every required section has a concrete, user-confirmed value, or when the user says "enough" / "stop". End with a one-paragraph recap and the path of the file you wrote. Set `complexity:` last.

**`templates/generic/commands/aigon-research-create.md` — a stricter framing-only variant** that explicitly does *not* let the model investigate:

> Before writing the brief, interview the user one question at a time about scope and framing only. For each question, provide a recommended answer based on the topic name and any inspiration the user named. **Do not read code, do not search the web, do not attempt to answer the research questions.** Walk down the template: Context (why now?) → Questions to Answer (what would actually settle this?) → Scope (in / out) → Inspiration. Stop when a future agent could research from the brief without coming back to ask. Typically 4–7 questions. End with `complexity:`.

**Both prompts should**:

- Label recommended answers explicitly (`Recommended: X — say "yes" to accept`) to mitigate leading-question risk.
- Accept `enough` / `stop` / `that's plenty` as a hard exit.
- Default-handle "I don't know" by writing the model's recommendation as the value and flagging it (e.g. `<!-- assumed; confirm during spec-review -->`).
- Refuse to invent model or effort values; only `complexity:` is set.

**Skip `--guided` flag entirely.** Add `--no-grill` for the fast path (`feature-now` should pass it). This matches the aigon convention of "behaviour-on by default, escape hatch for the power user."

**Defer to a follow-up feature: `/grill <feature-id>`** that runs the same interview against an existing spec to deepen it. This is genuinely useful but lower urgency than fixing the create step, and should not block this rollout.

### Risks worth naming in the implementation feature

1. **Conflict with `feature-create`'s existing "explore the codebase" guidance.** Already there in the current prompt; the guided variant just routes that exploration through Q&A. But it's worth being explicit so an agent doesn't both grill *and* run a full investigation phase.
2. **Interaction with the `planning_context:` frontmatter.** If the user ran plan mode before `feature-create`, the model has a plan file. The grill should *use* the plan as the source of recommended answers (not interview the user a second time about decisions already in the plan). This needs a sentence in the prompt.
3. **`feature-now` regression.** That command fast-tracks create + setup + implement. Default-on grill would break the "type a name, walk away" ergonomic. `feature-now` must pass `--no-grill` (or skip the create-step prompt entirely).
4. **Spec-review's role doesn't change.** Worth a single line in the implementation feature's spec to head off scope creep — the grill is about elicitation, not about the post-hoc improvement loop.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| guided-feature-create | Bake one-question-at-a-time elicitation with recommended answers into `aigon-feature-create.md`. Walk template sections in dependency order; investigate codebase to answer own questions; stop when sections are concrete or user says enough. Add `--no-grill` opt-out. | high | none |
| guided-research-create | Same elicitation pattern in `aigon-research-create.md` but framing-only — must not investigate or answer research questions. Typically 4–7 questions, ends with `complexity:`. | high | none |
| feature-now-skip-grill | `feature-now` and any other fast-track flow passes `--no-grill` so the type-a-name-walk-away ergonomic survives default-on guided creation. | medium | guided-feature-create |
| grill-existing-spec | New slash command `/grill <feature-id>` that runs the elicitation interview against an existing spec to deepen it (post-hoc). Does not replace `feature-spec-review`; complements it for cases where the spec is too thin to review. | low | guided-feature-create |
