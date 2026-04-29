# Research Findings: guided entity creation

**Agent:** Gemini (gg)
**Research ID:** 46
**Date:** 2026-04-29

---

## Key Findings

### 1. Matt Pocock's `/grill-me` Command
Matt Pocock's `/grill-me` skill (often used via Claude Code) stops "vibe coding" by forcing the AI to interview the user deeply before writing code. Its core instruction pattern is: *"Interview me relentlessly about every aspect of this plan until we reach a shared understanding. Walk down each branch of the design tree, resolving dependencies between decisions one-by-one. For each question, provide your recommended answer. Ask the questions one at a time."*
**Key Design Choices:**
- **One-at-a-time:** Asking questions sequentially prevents user overwhelm and ensures each point gets focus.
- **Recommendations:** Providing a suggested answer lowers the cognitive burden on the user; they can just agree rather than type out a full response.
- **Refusal to Proceed:** It firmly blocks execution until ambiguity is resolved, acting as a quality gate.

### 2. Other Elicitation Techniques
- **"Ask me clarifying questions first":** A widespread prompt pattern where the LLM is told to identify gaps and ask 3-5 questions before acting. Evidence suggests this reduces iteration tax and improves first-draft usability to 85-90% (vs. 60-70% without).
- **The Mom Test (Rob Fitzpatrick):** Focuses on past behaviors and hard facts rather than hypotheticals ("Tell me about the last time you..." instead of "Would you use..."). When translated to LLM prompts, this helps avoid user "fluff" and validates actual problems.
- **5 Whys & JTBD (Jobs to be Done):** Structured root-cause and goal-oriented frameworks that force the user to articulate the *why* behind a feature request, leading to more robust specs.

### 3. Failure Modes of Guided Q&A
- **Interrogation Fatigue:** Asking too many questions or asking them all at once can frustrate users who just want to move quickly.
- **Pointless Questions:** The LLM might ask questions that don't change the implementation approach just to fulfill a quota.
- **Blocking Velocity:** If a user has a trivial change, forcing them through an interview is a poor UX.
- **Lack of Answers:** Users might genuinely not know the answer yet (especially for research topics).

### 4. Differences Between Research vs. Feature Creation
- **`research-create`:** Highly exploratory. The user might only have a vague symptom or technology in mind. The elicitation should focus on mapping the unknown (e.g., "What are the boundaries of what you don't know?", "What is the worst-case outcome if we get this wrong?"). "I don't know" is a valid and expected answer that should shape the research questions.
- **`feature-create`:** Concrete and execution-oriented. The elicitation should focus on technical boundaries, edge cases, acceptance criteria, and UI/UX flows.

### 5. Exit Conditions
The ideal exit condition should not be a fixed number of questions. Instead, it should be a model self-assessment against the required sections of the underlying template. Once the LLM determines it has enough high-signal information to confidently draft a complete spec (Context, Scope, Questions/Acceptance Criteria), it should summarize and ask for final confirmation to proceed. The user should also always have an escape hatch (e.g., "That's enough, generate the spec").

### 6. Alignment with Aigon Constraints
Since `feature-spec-review` handles post-hoc improvement, the create-phase guided flow should focus purely on *initial elicitation*. It must remain non-investigative (no code reading/web searching during the create command itself).

### 7. Minimum Viable Change vs. Ambitious Vision
- **MVC:** Modify the system prompts in `templates/generic/commands/research-create.md` and `feature-create.md` to instruct the LLM: "Before drafting the spec, ask me up to 3 clarifying questions one at a time to fill in missing context. If I provide enough detail initially, you may skip this." This relies on the agent's built-in conversational loop.
- **Ambitious:** Introduce an explicit `--guided` flag (or make it the default behavior for bare `aigon feature-create` / `aigon research-create`) that launches an interactive, multi-turn interview loop specifically designed to populate the template, summarizing at the end before writing the file.

## Sources
- Matt Pocock Skills Repository: https://github.com/mattpocock/skills
- The Mom Test by Rob Fitzpatrick
- Prompt Engineering Patterns (Clarifying Questions): General community consensus across AI prompt libraries.

## Recommendation

I recommend implementing the **Ambitious** approach: introducing an explicit guided elicitation mode. Rather than silently baking it into the background prompt where it might act unpredictably or get cut off, a dedicated interactive flow ensures a high-quality spec generation experience.

Specifically, I recommend introducing a `--guided` flag (e.g., `aigon feature-create --guided "My Feature"`). This triggers a conversational loop guided by a specific "Interviewer Persona" prompt.

**Proposed Flow:**
1. User runs `aigon feature-create --guided "Add SAML Auth"`.
2. System loads an Interviewer Prompt: *"Act as a senior Staff Engineer. Your goal is to gather enough context to write a bulletproof spec. Ask questions ONE AT A TIME about edge cases, existing patterns, and acceptance criteria. Provide a recommended answer for each. Stop when you have enough to fill the spec template."*
3. The LLM interviews the user.
4. When satisfied, the LLM summarizes and writes the file.

This isolates the behavior from the fast-path (one-shot) creation while providing a powerful tool for complex topics. This can be applied to both feature and research creation. A separate command to "grill" an existing spec could be valuable later, but getting the initial creation right has higher leverage.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| create-guided-flag | Add a `--guided` flag to `feature-create` and `research-create` commands to trigger an interactive Q&A loop. | high | none |
| guided-interviewer-prompts | Develop specific LLM system prompts for the guided mode that enforce one-at-a-time questioning and self-assessed exit conditions based on template requirements. | high | create-guided-flag |
| spec-grill-command | Create a standalone `aigon spec-grill <ID>` command to apply the interview technique to existing specs in the inbox or backlog. | low | guided-interviewer-prompts |