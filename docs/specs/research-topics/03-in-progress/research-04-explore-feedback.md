# Research: explore-feedback

## Context

Aigon's current workflow enforces a structured **Research → Specification → Implementation** loop. Both research topics and feature specs originate from **product owners and builders** — people who decide what to build and why. There is no mechanism to incorporate input from **users** — the people who actually use the product being built.

In product development, feedback is a critical input channel:
- **Bug reports** from users encountering issues
- **Beta tester reports** with qualitative observations
- **Survey results** quantifying user sentiment and preferences
- **Support tickets** revealing pain points and confusion
- **Usage analytics** showing what works and what doesn't
- **Feature requests** from users (distinct from internally-conceived features)

Currently, if a developer wants to act on user feedback, they must manually translate it into either a research topic or a feature spec. There is no structured path for raw feedback to enter the Aigon workflow, be assessed, and produce actionable specs.

This research explores whether and how Aigon should expand to handle feedback loops — should feedback be a new first-class entity (like research topics and features), should it be channelled through existing research topics, or is a hybrid approach needed?

## Questions to Answer

- [ ] What are the common feedback formats in real product teams (bug trackers, survey tools, support systems, analytics platforms)?
- [ ] How does feedback differ from research topics in terms of lifecycle, volume, and urgency?
- [ ] Should feedback be a new top-level entity (`docs/specs/feedback/`) with its own kanban stages, or should it feed into the existing research and feature pipelines?
- [ ] What triage/assessment workflow is needed to process raw feedback into actionable items?
- [ ] Can AI agents effectively classify, deduplicate, and prioritise feedback, or does this require human judgement?
- [ ] What is the minimum viable feedback pipeline — the simplest useful thing Aigon could add?
- [ ] How should feedback items link to the features or fixes they produce (traceability)?
- [ ] Are there existing open-source or well-known frameworks for feedback-driven development that Aigon could draw from?
- [ ] How should feedback be attributed to the user who provided it? Should feedback documents include front matter or metadata with a user identifier (e.g., name, email, username) and an optional URL linking back to the source in a third-party system? The goal is a system-agnostic attribution model — not tied to any specific tool, but with enough structure to trace feedback back to who said it and where it originated.

## Scope

### In Scope
- Designing a feedback ingestion and triage workflow for Aigon
- Determining whether feedback needs its own entity type or can reuse research/features
- Defining the lifecycle stages for feedback items (e.g., inbox → triaged → actionable → done)
- Exploring how AI agents can assist with feedback classification and deduplication
- Mapping the relationship between feedback items and the features/fixes they spawn
- Considering multiple feedback sources (manual entry, file import, potential integrations)
- CLI command design for feedback operations (`aigon feedback-create`, `aigon feedback-triage`, etc.)
- Feedback attribution metadata — designing a front matter schema for user identity (name, identifier) and optional source URL, kept system-agnostic

### Out of Scope
- Building integrations with specific external tools (Jira, Linear, Intercom, etc.) — that's a future feature
- Real-time feedback collection (webhooks, APIs) — initial implementation should be manual/file-based
- Analytics dashboards or reporting — Aigon is a CLI workflow tool
- Feedback on the Aigon tool itself (meta-feedback) — this is about product feedback for projects using Aigon
- Sentiment analysis or NLP beyond what the AI agent naturally provides

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
