---
complexity: high
# agent: cc    # optional — id of the agent that owns this research spec;
#              #   see feature-template.md for precedence rules.
---

# Research: investigate-spdd

## Context

[Structured Prompt-Driven Development (SPDD)](https://martinfowler.com/articles/structured-prompt-driven/), as described by Scott Nasello and Suzanne Taylor on Martin Fowler's site, is a framework for structuring how teams work with coding agents (“human–agent symbiosis,” explicit workflow stages, artefacts, prompts, tooling). Aigon already centres features and research specs, agent personas, dashboards, CLI workflow, and human review loops—overlap and tension with SPDD are plausible but unexplored here.

This research exists to **consume the primary article thoroughly**—including **links, examples, diagrams, glossary, referenced repositories or tools** surfaced in or from that piece—and distill **ideas that could inspire** later improvements to the Aigon development workflow **without prescribing implementation** in this briefing document.

## Questions to Answer

- [ ] What are SPDD's **named stages**, **artifacts** (documents, manifests, trackers, etc.), and **roles/responsibilities** as the article defines them—not just high-level summaries?
- [ ] What **concrete prompting patterns** does the framework recommend (structuring tasks, escalation, checkpoints, decomposition)? Which are transferable to Markdown specs, agent prompts, or dashboard affordances versus environment-specific baggage?
- [ ] Which **referenced code listings, repos, or companion materials** appear in or from the article, and what do they instantiate (patterns, tooling, automation)?
- [ ] How does SPDD treat **verification, review, rework, observability**, and communication between humans and agents—explicitly comparable to or distinct from concepts Aigon encodes today (implementation logs, spec reviews, recurrence, evaluator flows, etc.)?
- [ ] What **mental models or vocabulary** does SPDD use that might clarify—or clash with—Aigon's notions of features vs research topics, backlog states, autonomous runs, Fleet/Drive metaphors?
- [ ] Against each major SPDD pillar, brainstorm **_candidate inspiration areas_** for Aigon (hypotheses only, not decisions): prompts, dashboards, lifecycle transitions, authoring templates, onboarding docs, telemetry. Which ideas look **cheap wins** versus **architecture-level** reconsiderations?
- [ ] Where does SPDD **assume** toolchain or org context (enterprise, Claude Code-first, synchronous collaboration) that limits direct lift into Aigon or its OSS/private split?

## Scope

### In Scope

- The Fowler-hosted article [`https://martinfowler.com/articles/structured-prompt-driven/`](https://martinfowler.com/articles/structured-prompt-driven/) and **material explicitly linked from it or nested within that reading path** used to clarify SPDD itself (referenced posts, repos, glossary).
- Connecting SPDD constructs to **Aigon workflows** strictly as **inspiration and candidate improvements** framed for follow-up prioritisation—not a rewrite of Aigon doctrine in this document.

### Out of Scope

- Implementing product changes in this research pass.
- Broader “state of agentic SDLC” literature beyond what the article and its direct references provide (unless the article points there as essential to understanding SPDD).
- Legal or licensing analysis of any linked code except where it blocks adoption of a pattern.

## Inspiration

- Scott Nasello & Suzanne Taylor, *Structured Prompt-Driven Development (SPDD)* — Martin Fowler, [`https://martinfowler.com/articles/structured-prompt-driven/`](https://martinfowler.com/articles/structured-prompt-driven/)

## Findings

<!-- To be completed during `research-do` / agent execution. -->

## Recommendation

<!-- To be completed after synthesis (e.g. research-eval). -->

## Output

<!-- After evaluation: link any feature specs created via `aigon feature-create`, or note “none”. -->
- [ ] Feature:
