---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T22:10:03.974Z", actor: "cli/research-prioritise" }
---

# Research: guided-entity-creation

## Context

Today `aigon research-create` and `aigon feature-create` produce a spec from whatever
the user types on the command line plus a few headers in a markdown template. The
quality of the resulting spec is bounded by how much the user happened to articulate
in that one prompt. In practice, specs land thin: missing context, fuzzy scope,
unstated assumptions, no falsifiable success criteria. Downstream this shows up as
specs that get bounced through `feature-spec-review` / `research-spec-review` cycles,
or worse, agents implementing the wrong thing because the brief was under-specified.

Matt Pocock's `/grill-me` slash command is a well-known counter-pattern: instead of
the LLM accepting a vague request and running with it, the LLM interrogates the user
— one targeted question at a time — until it has enough signal to produce a good
artifact. Anecdotally this dramatically lifts spec quality with very little user
effort (the user just answers questions they would have had to think about anyway,
in an order the model picks).

We want to understand *why* `/grill-me` works, what other elicitation techniques
exist, and how to graft the strongest version of this pattern onto our `research-create`
and `feature-create` flows so that creating an entity becomes a short, guided Q&A
that produces a substantially better spec than the current one-shot template fill-in.

## Questions to Answer

- [ ] What exactly does Matt Pocock's `/grill-me` do? Capture the prompt/instructions verbatim if public, otherwise the closest reconstruction with sources (blog posts, videos, repos, tweets).
- [ ] What design choices make `/grill-me` effective? (e.g. one-question-at-a-time vs. batched, when it stops, how it handles "I don't know", whether it summarises before exiting, tone, refusal to proceed without answers.)
- [ ] What other elicitation / requirements-gathering techniques exist that are relevant here? Cover at least: structured interviewing (5 Whys, Socratic questioning), product-discovery frameworks (JTBD interviews, Mom Test, Lean Canvas prompts), agile story refinement (INVEST, Gherkin/BDD given-when-then), and any LLM-native prompt patterns (e.g. "ask me clarifying questions before answering" system prompts, OpenAI's "interview mode" cookbooks, Cursor/Claude Code community variants).
- [ ] Which of those techniques have evidence (studies, case reports, benchmarks) of improving artifact quality, and which are folklore?
- [ ] What are the failure modes of a guided Q&A flow? (Interrogation fatigue, leading questions, the model asking pointless questions, blocking the user when they want to move fast, handling users who genuinely don't have answers yet.)
- [ ] How should the flow differ between **research-create** (exploratory, the user often doesn't know the answer — that's why it's research) and **feature-create** (concrete, the user usually does know what they want, just hasn't written it down)?
- [ ] What's the right exit condition? Fixed N questions? Model self-assesses when the spec template's required sections are answerable? User can say "enough"?
- [ ] How do we keep the pattern aligned with existing Aigon constraints — specifically: `feature-spec-review` already exists as a downstream improvement step, complexity frontmatter must still be set, and create commands must remain non-investigative (they don't read code or search the web)?
- [ ] What's the minimum-viable change to the existing `templates/generic/commands/aigon-research-create.md` and `aigon-feature-create.md` prompts to introduce guided elicitation, and what would a more ambitious version look like (e.g. a separate `--guided` flag, or making it the default)?
- [ ] Is there value in a standalone `/grill-me` style command that operates on an *existing* spec to deepen it, in addition to (or instead of) baking elicitation into create?

## Scope

### In Scope
- Prompt-engineering patterns for eliciting information from a human via an LLM agent.
- Public material on Matt Pocock's `/grill-me` and similar community slash commands.
- Adapting our two creation flows (`research-create`, `feature-create`) — including how the guided session interacts with the existing `complexity:` frontmatter and downstream review steps.
- Defining what "good enough to stop asking" looks like for each entity type.
- Recommending whether elicitation should be: (a) baked into create, (b) opt-in via flag, (c) a separate command, or (d) a separate review-style command that operates on an existing spec.

### Out of Scope
- Implementing the change — this research only produces a recommendation and follow-up feature specs.
- Redesigning `feature-spec-review` or `research-spec-review`; those continue to exist as the post-hoc improvement path.
- Changing how agents run *during* feature/research execution (this is purely about the create step).
- Voice / multimodal elicitation.
- Any change to the underlying spec templates' section structure (Context / Questions / Scope etc.) — we are changing how the sections get filled, not what they are.

## Inspiration / Starting Points
- Matt Pocock's `/grill-me` (search: "Matt Pocock grill-me", his blog at mattpocock.com, YouTube, X/Twitter, his Total TypeScript / AI Hero repos).
- Rob Fitzpatrick, *The Mom Test* — interview heuristics that translate well to LLM elicitation.
- "Ask me clarifying questions first" prompt patterns (widely shared in LLM prompt-engineering communities).
- Claude Code / Cursor community slash-command collections that include interrogation-style prompts.

## Findings
<!-- Filled in by the research-do agent. -->

## Recommendation
<!-- Filled in by the research-do agent. Should explicitly answer: which option (bake-in / flag / separate command / post-hoc) and why, plus a sketch of the resulting prompt(s). -->

## Output
- [ ] Feature:
