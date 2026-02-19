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

- [x] What are the common feedback formats in real product teams (bug trackers, survey tools, support systems, analytics platforms)?
- [x] How does feedback differ from research topics in terms of lifecycle, volume, and urgency?
- [x] Should feedback be a new top-level entity (`docs/specs/feedback/`) with its own kanban stages, or should it feed into the existing research and feature pipelines?
- [x] What triage/assessment workflow is needed to process raw feedback into actionable items?
- [x] Can AI agents effectively classify, deduplicate, and prioritise feedback, or does this require human judgement?
- [x] What is the minimum viable feedback pipeline — the simplest useful thing Aigon could add?
- [x] How should feedback items link to the features or fixes they produce (traceability)?
- [x] Are there existing open-source or well-known frameworks for feedback-driven development that Aigon could draw from?
- [x] How should feedback be attributed to the user who provided it? Should feedback documents include front matter or metadata with a user identifier (e.g., name, email, username) and an optional URL linking back to the source in a third-party system? The goal is a system-agnostic attribution model — not tied to any specific tool, but with enough structure to trace feedback back to who said it and where it originated.

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

### 1. Feedback is a distinct input stream (not “mini research”)

Feedback and research topics differ materially:
- **Origin:** feedback is external (users/customers/testers); research topics are internal (builders)
- **Volume:** feedback is high-volume and noisy; research topics are low-volume and curated
- **Urgency:** feedback can be urgent (bugs/outages); research is deliberate and scheduled
- **Granularity:** feedback is often atomic; research topics are broad explorations
- **Primary need:** feedback needs **reduction + routing** (dedupe, cluster, triage); research needs **investigation + synthesis**

Treating raw feedback as research from day one adds friction and hides operational needs (rapid triage for high-severity issues).

### 2. Common feedback formats are heterogeneous but share core metadata needs

Typical formats in real teams:
- Bug reports (semi-structured, steps/expected/actual)
- Support tickets (semi-structured, high volume)
- Feature requests (unstructured problem statements)
- Survey free-text + scores (batch/periodic)
- Usage analytics signals (structured events, trend-based)

Regardless of source, teams need consistent metadata for triage and follow-up:
- **Reporter identity** (system-agnostic identifier)
- **Source channel + optional URL** back to the original system
- **Type/category**, **severity/impact**, **tags/theme**

### 3. A lightweight feedback lifecycle maps cleanly to Aigon

Recommended lifecycle stages (folder-based + front matter status):
`01-inbox` → `02-triaged` → `03-actionable` → `04-done`, plus terminal lanes like `05-wont-fix` and `06-duplicate` (optional).

### 4. AI is high-leverage at triage, but humans must gate decisions

AI is well-suited to:
- first-pass **classification** (bug/request/question/etc.)
- **summarization** and suggested tags/themes
- **duplicate-candidate suggestions**

Humans should gate:
- prioritization tradeoffs and roadmap alignment
- accept/reject decisions and “wont-fix”

### 5. Traceability is the differentiator

If feedback becomes first-class, Aigon can make “why did we build this?” and “what happened to my report?” answerable by design:
- feedback items link forward to the features/research they spawned
- features/research link back to the motivating feedback

## Sources / Logs
- Agent findings: `docs/specs/research-topics/logs/research-04-cc-findings.md`
- Agent findings: `docs/specs/research-topics/logs/research-04-cx-findings.md`
- Agent findings: `docs/specs/research-topics/logs/research-04-gg-findings.md`

## Recommendation

Adopt a **hybrid model**:

1. **Introduce a first-class `feedback` entity** (file-based, metadata-rich) for intake + triage.
2. Keep **research topics and feature specs unchanged as downstream artifacts**.
3. Provide **promotion + traceability bridges** from feedback → research/features.
4. Use AI for triage suggestions, with **explicit human confirmation** at triage and promotion boundaries.

Start with an MVP focused on manual ingestion + triage + promotion + links. Defer batch import and scoring/policy until the workflow is proven.

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->

### Selected (MVP)

These group the consolidated suggestions (1–7) into larger, shippable features.

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| feedback-foundation | Add `docs/specs/feedback/` entity: folder lifecycle + front matter schema (incl. attribution + link fields) | high | `aigon feature-create "feedback-foundation"` |
| feedback-triage-workflow | Add CLI for intake + triage: `feedback-create`, `feedback-triage`, `feedback-list`, incl. AI triage suggestions w/ human confirm | high | `aigon feature-create "feedback-triage-workflow"` |
| feedback-promote-traceability | Add `feedback-promote` and enforce bidirectional traceability links between feedback and spawned research/features | high | `aigon feature-create "feedback-promote-traceability"` |

### Feature Dependencies
- `feedback-triage-workflow` depends on `feedback-foundation`
- `feedback-promote-traceability` depends on `feedback-triage-workflow`

### Nice-to-have (Later)
- feedback-import-and-prioritization: batch import + optional priority policy/scoring (consolidates prior items 8 and 9)

### Created Feature Specs
- [x] Feature: `docs/specs/features/01-inbox/feature-feedback-foundation.md`
- [x] Feature: `docs/specs/features/01-inbox/feature-feedback-triage-workflow.md`
- [x] Feature: `docs/specs/features/01-inbox/feature-feedback-promote-traceability.md`
