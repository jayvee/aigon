---
complexity: high
transitions:
  - { from: "in-progress", to: "done", at: "2026-04-29T23:38:13.163Z", actor: "cli/research-close" }
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

Three agents (cc, gg, cx) produced findings in `docs/specs/research-topics/logs/research-46-{cc,gg,cx}-findings.md`. Synthesis below; full detail in the per-agent files.

**Consensus across all three agents:**
- The leverage in elicitation patterns like Matt Pocock's `/grill-me` is the *combination* of (a) one-question-at-a-time, (b) recommended-answer attached to each question (so the user can ratify rather than author), (c) decision-tree traversal in dependency order, (d) investigate-instead-of-asking when the answer is in the codebase, (e) adversarial framing. No single trick carries the load.
- Exit condition must be coverage-based (model self-checks template sections), not fixed N.
- `feature-create` and `research-create` need *deliberately different* prompts. Research must allow "I don't know" → research question; investigation is forbidden because that breaks the contract that research-create produces a brief for a *later* agent.
- `feature-spec-review` / `research-spec-review` stay; deepen raises the floor of what enters review.
- `complexity:` frontmatter must still be set at the end, per F313.

**Divergent on three design questions:**
- *Default-on or opt-in:* cc wanted default-on with `--quick`; cx and gg wanted opt-in via flag or `--agent`-only. **Resolved → default-on with `--quick` and a global `deepen.enabled` config toggle.**
- *Which file to edit:* cc said the user-facing slash commands (`templates/generic/commands/*.md`); cx said the legacy `--agent` drafting prompts (`templates/prompts/*-draft.md`); gg said the create commands. **Resolved → the slash command prompts.** The `--agent` drafting path is not in scope.
- *Investigate during create:* cc said yes for feature-create, no for research-create; cx and gg said no for both. **Resolved → cc's split.** feature-create can investigate; research-create cannot.

## Recommendation

Bake the deepen interview directly into `templates/generic/commands/feature-create.md` and `templates/generic/commands/research-create.md` as default behavior, with a `--quick` per-call opt-out and a `deepen.enabled` config toggle (project + user precedence) for users who genuinely prefer one-shot creation. Use entity-specific prompt rules — feature-create can read code to answer its own questions; research-create is framing-only. Do not introduce a separate `/deepen` slash command and do not persist a Q&A transcript sidecar. The standalone `aigon spec-deepen <ID>` for existing specs was considered and explicitly deferred — `feature-spec-review` already covers post-hoc improvement.

The naming choice "deepen" is deliberate: the inspiration is Pocock's skill, but the implementation stands on its own. No "grill" terminology in any spec, prompt, command, or config key.

## Output

### Set Decision

- Proposed Set Slug: `deepen-create`
- Chosen Set Slug: `deepen-create`

### Selected Features

| Feature ID | Feature Name | Description | Priority | Create Command |
|---|---|---|---|---|
| F463 | deepen-create-1-feature-prompt | Add deepen interview pattern to `feature-create.md` slash command. Investigates codebase to answer its own questions. | high | `aigon feature-create "deepen-create-1-feature-prompt" --set deepen-create` |
| F464 | deepen-create-2-research-prompt | Add deepen interview pattern to `research-create.md` slash command. Framing-only — no code reading, no answering research questions; "I don't know" → research question. | high | `aigon feature-create "deepen-create-2-research-prompt" --set deepen-create` |
| F465 | deepen-create-3-toggle-and-quick-flag | Default-on behavior, `--quick` per-call flag, `deepen.enabled` config (project + user). | high | `aigon feature-create "deepen-create-3-toggle-and-quick-flag" --set deepen-create` |
| F466 | deepen-create-4-feature-now-quick | `feature-now` passes `--quick` so the type-a-name-walk-away ergonomic survives default-on. | medium | `aigon feature-create "deepen-create-4-feature-now-quick" --set deepen-create` |

### Feature Dependencies

- F465 depends on F463 and F464 (the toggle gates prompts that must already exist).
- F466 depends on F465 (the `--quick` flag must exist before `feature-now` can pass it).

### Not Selected

- **spec-deepen-command** (standalone `aigon spec-deepen <ID>` for existing specs) — deferred. `feature-spec-review` already covers post-hoc improvement; the high-leverage moment is at create time. Add later if a real need shows up.
- **complexity-inference-on-create** — redundant. `feature-create` and `research-create` already require the agent to set `complexity:` from a rubric. The deepen flow inherits this with strictly more context. Folded into F463/F464 as a one-sentence-rationale requirement instead of a separate feature.
- **deepen-transcript-to-spec-log** (Q&A transcript sidecar) — rejected. Spec is the contract; a sidecar transcript splits the source of truth, goes stale on `feature-spec-review`, and contradicts the no-sidecar lesson from F332. Anything worth surfacing from the Q&A belongs in the spec body (Out of Scope, inline `<!-- assumed; confirm during spec-review -->`, or one-sentence rationale).
- **deepen-create-flag** (explicit `--deepen` opt-in flag) — rejected in favor of default-on. Thin specs are the current default failure mode; an opt-in flag wouldn't be typed by the people who need it most.
