# Research Findings: explore feedback

**Agent:** Claude (cc)
**Research ID:** 04
**Date:** 2026-02-19

---

## Key Findings

### 1. Common Feedback Formats

Product teams handle six primary feedback types, each with distinct characteristics:

| Feedback Type | Volume | Urgency | Structure | Typical Source |
|---------------|--------|---------|-----------|----------------|
| **Bug reports** | High | High (severity-dependent) | Semi-structured (steps to reproduce, expected/actual) | Issue trackers, support channels |
| **Beta tester reports** | Medium | Medium | Unstructured narrative with qualitative observations | Beta programs, TestFlight, staged rollouts |
| **Survey results** | Batch (periodic) | Low | Structured (Likert scales, NPS, free-text) | SurveyMonkey, Typeform, in-app surveys |
| **Support tickets** | High (continuous) | High | Semi-structured (subject + body + metadata) | Intercom, Zendesk, Help Scout |
| **Usage analytics** | Very high (continuous) | Low (trend-based) | Highly structured (events, funnels, cohorts) | Mixpanel, Amplitude, PostHog |
| **Feature requests** | Medium | Low-Medium | Unstructured (free-text wish lists) | Community forums, sales calls, support |

Key insight: Bug reports and support tickets demand fast triage loops (hours/days), while survey results and analytics demand periodic synthesis (weeks/sprints). Feature requests sit in between. A feedback system must handle both cadences.

### 2. Feedback Lifecycle

The industry-standard feedback lifecycle follows four stages, often called the **feedback loop**:

**Stage 1 -- Collection (Inbox)**
Raw feedback arrives from multiple channels. Best practice is to funnel everything into a single intake point. Metadata captured at this stage: who said it, when, what channel, their plan/MRR, any verbatim quotes.

**Stage 2 -- Analysis (Triage)**
Feedback is classified by type (bug, request, praise, confusion), tagged by product area/theme, deduplicated against existing items, and assessed for frequency and impact. Teams group feedback into themes: UX friction, feature requests, bugs, pricing complaints. Then slice by user segment, lifecycle stage, and customer value.

**Stage 3 -- Action (Prioritization)**
Triaged feedback is prioritized using scoring frameworks (RICE, ICE, Kano -- see finding #6), translated into actionable tickets (bugs, stories, research topics), and integrated into the regular development cycle. Many teams allocate a fixed percentage of each sprint to feedback-driven work.

**Stage 4 -- Follow-up (Closing the Loop)**
Users are notified that their feedback led to a change. This is done publicly through changelogs, in-app announcements, or direct replies. Closing the loop builds trust and encourages future feedback.

For Aigon, this maps naturally to a kanban flow: `01-inbox` -> `02-triaged` -> `03-actionable` -> `04-done`.

### 3. Feedback vs Research Topics

| Dimension | Feedback | Research Topics |
|-----------|----------|-----------------|
| **Origin** | External (users, customers, testers) | Internal (product owners, builders, engineers) |
| **Volume** | High -- dozens to thousands of items per cycle | Low -- a handful at a time |
| **Urgency** | Variable -- bugs are urgent, requests are not | Low -- research is deliberate and scheduled |
| **Granularity** | Often atomic (one complaint, one request) | Broad (explore a topic, answer questions) |
| **Lifecycle** | Short for bugs (days), long for requests (months) | Medium (weeks to months) |
| **Deduplication** | Critical -- many users report the same thing | Rare -- topics are curated internally |
| **Output** | Spawns features, bugs, or research topics | Spawns feature specs |
| **AI suitability** | High -- classification, clustering, dedup are well-suited | Medium -- synthesis and summarization |

Key insight: Feedback and research serve different purposes. Research is a deep, deliberate investigation. Feedback is a high-volume, externally-driven signal that often needs to be **reduced** (deduplicated, clustered) before it can inform decisions. They should be separate entities with a clear bridge between them (feedback can spawn research topics or feature specs).

### 4. Triage Workflows

Industry triage best practices observed across tools and methodologies:

**Who triages:** There is no single owner. Whoever receives feedback (support, sales, engineering) should triage it immediately and route it to the product team. The key is a transparent, shared process -- not a dedicated person.

**Triage actions:**
1. **Classify** -- Is this a bug, feature request, UX issue, praise, or noise?
2. **Tag** -- Which product area, component, or theme does it relate to?
3. **Deduplicate** -- Does this match an existing feedback item? If so, merge (increment the "votes" count and add the new user as a supporter).
4. **Assess severity/impact** -- How many users are affected? What is the business impact (MRR at risk, churn signal)?
5. **Route** -- Send to the appropriate backlog (bug tracker, feature request board, research topic).

**Deduplication approaches:**
- **Manual keyword search** -- simple but does not scale.
- **Tag-based grouping** -- effective when tagging is disciplined.
- **Semantic similarity** -- AI-powered, using embeddings (BERT, sentence-transformers) to find near-duplicates. Cosine similarity thresholds of 0.85+ typically indicate duplicates.
- **LLM-assisted** -- ask an LLM to compare a new item against existing items and suggest merges. More accurate than embeddings alone but slower.

For Aigon (a CLI tool without a database), a practical approach is: when creating feedback, the CLI can list existing feedback titles/summaries and prompt the agent or user to confirm whether it duplicates an existing item.

### 5. AI-Assisted Feedback Processing

**What AI does well:**
- **Classification** -- Categorizing feedback by type (bug/request/praise) and product area. AI can process thousands of items with high accuracy.
- **Theme extraction** -- Clustering feedback into themes using semantic similarity. Transformer-based models (BERT, GPT) convert text to vectors; clustering algorithms (K-means, hierarchical) group similar items.
- **Summarization** -- Condensing many related feedback items into a single summary paragraph.
- **Sentiment detection** -- Basic positive/negative/neutral classification.
- **Deduplication** -- Semantic similarity scoring to identify near-duplicates. LLM-based approaches achieve roughly 60% accuracy vs 30% for traditional NLP techniques -- better than nothing but far from perfect.

**What AI does poorly (limits):**
- **Strategic prioritization** -- AI can score items on mechanical criteria (frequency, recency) but cannot weigh business context, competitive dynamics, or team capacity. Product strategy remains a deeply human function.
- **Nuance and empathy** -- AI may misclassify frustrated feature requests as bugs, or miss cultural/contextual subtleties.
- **Data quality dependency** -- AI is only as good as the input. Inconsistent terminology, vague feedback, and sampling bias reduce accuracy. Organizations must audit data sources and normalize terminology.
- **Stakeholder trust** -- Teams used to subjective prioritization may distrust AI outputs. Transparency is essential: show the reasoning, link back to source feedback, and let humans override.

For Aigon, AI-assisted triage is a strong fit: when an agent runs `aigon feedback-triage`, the LLM can suggest classification, tags, severity, and potential duplicates. The human or agent reviews and confirms. This is an "AI suggests, human decides" pattern.

### 6. Prioritization Frameworks

Six well-established frameworks relevant to feedback-driven development:

**RICE Scoring** (developed by Intercom)
- **Reach** -- How many users will this affect in a given period?
- **Impact** -- How much will it move the needle per user? (scored 0.25 to 3)
- **Confidence** -- How sure are we about the estimates? (percentage)
- **Effort** -- How many person-months?
- Score = (Reach x Impact x Confidence) / Effort
- Best for: Comparing feature requests with data on user counts.

**ICE Scoring**
- **Impact** -- Potential impact on a goal (1-10)
- **Confidence** -- Certainty in the estimate (1-10)
- **Ease** -- How easy to implement (1-10)
- Score = Impact x Confidence x Ease
- Best for: Quick, lightweight prioritization when data is limited. Risk: subjective bias without shared guidelines.

**Kano Model**
- Classifies features into: Must-have (expected), Performance (the more the better), Delighters (unexpected joy), Indifferent, Reverse (actively unwanted).
- Does not rank order -- it shapes understanding of customer value.
- Best for: Discovery phase, understanding emotional value of features.

**MoSCoW**
- Must have, Should have, Could have, Won't have (this time).
- Best for: Release planning and scope negotiation.

**Jobs-to-be-Done (JTBD)** (developed by Tony Ulwick / Strategyn)
- Focuses on the "job" a customer is trying to accomplish, not the feature they request.
- Four elements: Job performer, Job to be done, Circumstances, Customer needs.
- Best for: Reframing feature requests into underlying needs. Prevents building exactly what users ask for when a different solution would serve the job better.

**Weighted Scoring**
- Define custom criteria (strategic alignment, customer demand, technical feasibility, etc.) with weights.
- Score each item on each criterion, compute weighted total.
- Best for: Organizations with clear strategic priorities.

Recommended combination (per Plane.so analysis): Use **Kano** during discovery to understand value, **RICE** to score the shortlisted ideas, and **MoSCoW** to finalize what fits into the next release.

For Aigon, RICE or ICE could be captured as optional front matter fields on feedback items, letting teams score and sort. The CLI could compute the score from the fields.

### 7. Feedback Attribution

Effective feedback systems store the following metadata per item:

**Core attribution fields:**
- **Reporter name/identifier** -- Who submitted this? (name, username, email)
- **Reporter segment** -- What plan are they on? What tier? (enterprise, free, beta)
- **Reporter value** -- MRR, contract value, lifetime value
- **Source channel** -- Where did this come from? (support ticket, survey, sales call, beta report)
- **Source URL** -- Link back to the original item in the external system (e.g., Zendesk ticket URL, Intercom conversation URL)
- **Timestamp** -- When was it reported?

**Savio's approach** (commercial, well-documented) is representative: customer metadata (MRR, plan, custom attributes) is automatically imported from CRM/support integrations and stored alongside every feedback item. Users can then filter and prioritize by "show me all requests from Enterprise customers" or "sort by total MRR of requesting customers."

**For Aigon (system-agnostic, file-based)**, a practical front matter schema:

```yaml
---
type: feedback
id: FB-001
title: "Search results don't show recent items"
category: bug | feature-request | ux-issue | praise | question
severity: critical | high | medium | low
status: inbox | triaged | actionable | done | wont-fix
reporter:
  name: "Jane Doe"
  identifier: "jane@example.com"  # or username, user ID
  segment: "enterprise"           # optional
source:
  channel: "support-ticket"       # or: beta-report, survey, analytics, manual
  url: "https://support.example.com/tickets/12345"  # optional
  date: 2026-02-19
tags: [search, recency, relevance]
votes: 3                          # number of users who reported the same thing
linked-features: []               # populated when feedback spawns a feature
linked-research: []               # populated when feedback spawns research
---
```

This schema is deliberately system-agnostic: no Jira IDs, no Linear references, no tool-specific fields. The `source.url` field provides the escape hatch to trace back to any external system.

### 8. Traceability

How feedback systems link items to their outcomes:

**Bidirectional linking** is the gold standard. Productboard implements this as "insights": each piece of user feedback is linked to one or more feature ideas. When a feature ships, every linked feedback item can be traced forward. When reviewing a feature, every supporting feedback item can be traced backward.

**Productboard's AI approach:** Their AI automatically suggests links between new feedback and existing feature ideas in the product hierarchy. Citations are added to AI-generated content, linking each bullet point back to its source feedback. This maintains transparency and trust.

**For Aigon (file-based):**
- Feedback items contain a `linked-features` array in front matter, listing feature IDs they spawned.
- Feature specs contain a `linked-feedback` array in front matter, listing feedback IDs that motivated them.
- When running `aigon feedback-promote` (or similar), the CLI updates both sides of the link.
- This bidirectional linking ensures: "Why did we build this?" can always be answered by tracing feature -> feedback, and "What happened to my report?" can be answered by tracing feedback -> feature.

### 9. Open-Source Tools and Their Data Models

**Fider** (Go + React, PostgreSQL, CQRS pattern)
- GitHub: https://github.com/getfider/fider
- Entities: Tenant, User, Post (feature request/suggestion), Comment, Vote, Tag
- Posts have statuses: Open, Planned, Started, Completed, Declined, Duplicate
- Voting system for prioritization (one vote per user per post)
- Multi-tenant architecture
- Strengths: Lightweight, privacy-first, simple data model
- Limitations: No attribution metadata beyond basic user info, no RICE/ICE scoring

**Astuto** (Rails, self-hosted)
- GitHub: https://github.com/astuto/astuto
- Features: Feedback boards, voting, comments, status tracking, webhooks, REST API, moderation queue, anonymous feedback
- Strengths: Simple, Rails-based (easy to extend), webhook integrations
- Limitations: Less mature than Fider, limited analytics

**LogChimp** (open-source)
- Feedback tracking and analysis platform
- Feature request management with voting
- Less documented than Fider/Astuto

**Featurebase** (commercial, but documents good patterns)
- Feedback portal with voting, status updates, changelogs
- Auto-categorization and deduplication
- Integration-heavy (Jira, Linear, Slack)

**Common patterns across all tools:**
1. Public-facing feedback board where users submit and vote
2. Status lifecycle: Open -> Planned -> In Progress -> Done / Declined / Duplicate
3. Voting/upvoting as a lightweight prioritization signal
4. Tagging/categorization for organization
5. Comments/discussion threads per item
6. Admin triage view separate from public view

## Sources

- [Master Product Feedback in 2025: Complete Guide](https://qualaroo.com/blog/how-to-build-feedback-into-your-products-lifecycle/) -- Feedback lifecycle stages and integration into product development
- [Product Feedback Loop](https://launchdarkly.com/blog/product-feedback-loop/) -- Collection, analysis, action, follow-up framework
- [Customer Feedback Loops](https://productschool.com/blog/user-experience/customer-feedback-loop) -- Closing the loop best practices
- [How to Triage and Manage Feedback | airfocus](https://airfocus.com/product-learn/how-to-triage-and-manage-feedback/) -- Triage ownership and process design
- [How to Automate Product Feedback Triage with AI](https://bagel.ai/blog/automated-feedback-triage-for-busy-product-teams/) -- AI-assisted triage workflows
- [Bug Triage Best Practices | Atlassian](https://www.atlassian.com/agile/software-development/bug-triage) -- Structured triage methodology
- [Triage in Software Engineering: A Systematic Review](https://arxiv.org/html/2511.08607v1) -- Academic review of triage methods
- [Survey on Bug Deduplication and Triage Methods](https://www.mdpi.com/2076-3417/13/15/8788) -- Deduplication techniques and approaches
- [RICE vs ICE vs Kano: Which framework works best in 2025?](https://plane.so/blog/rice-vs-ice-vs-kano-which-framework-works-best-in-2025-) -- Comparative analysis of prioritization frameworks
- [Prioritization Frameworks | Savio](https://www.savio.io/product-roadmap/prioritization-frameworks/) -- Practical framework comparison
- [RICE Scoring Model | ProductPlan](https://www.productplan.com/glossary/rice-scoring-model/) -- RICE definition and calculation
- [Jobs-to-be-Done Framework | ProductPlan](https://www.productplan.com/glossary/jobs-to-be-done-framework/) -- JTBD overview
- [Jobs-to-be-Done: A Framework for Customer Needs](https://jobs-to-be-done.com/jobs-to-be-done-a-framework-for-customer-needs-c883cbf61c90) -- Tony Ulwick's original framework
- [How to Track Customer Feedback | Savio](https://www.savio.io/blog/how-to-track-customer-feedback/) -- Metadata and attribution patterns
- [Record MRR, plan, and other customer data | Savio](https://www.savio.io/features/save-customer-data-with-product-feedback/) -- Customer data alongside feedback
- [Link user feedback to features using insights | Productboard](https://support.productboard.com/hc/en-us/articles/360056354514-Link-user-feedback-to-related-feature-ideas-using-insights) -- Bidirectional feedback-to-feature linking
- [Link insights automatically with Productboard AI](https://support.productboard.com/hc/en-us/articles/26949590820627-Link-insights-automatically-with-Productboard-AI) -- AI-powered automatic linking
- [Traceability in Product Development | Innerview](https://innerview.co/blog/traceability-in-product-development-a-comprehensive-guide) -- Traceability concepts and implementation
- [What Is Traceability in Product Development? | Dovetail](https://dovetail.com/product-development/what-is-traceability-in-product-development/) -- Traceability overview
- [Using AI for Product Roadmap Prioritization | Productboard](https://www.productboard.com/blog/using-ai-for-product-roadmap-prioritization/) -- AI limitations in strategic decisions
- [How AI Changes Product Management | Reforge](https://www.reforge.com/blog/how-ai-changes-product-management) -- AI capabilities and limits
- [Customer Feedback Clustering using NLP | Modulai](https://modulai.io/case/customer-feedback-clustering-using-state-of-the-art-nlp/) -- Semantic clustering for feedback
- [Duplicate Detection with GenAI](https://medium.com/data-science/duplicate-detection-with-genai-ba2b4f7845e7) -- LLM-based deduplication accuracy
- [Fider GitHub](https://github.com/getfider/fider) -- Open-source feedback platform (Go + React)
- [Fider DeepWiki](https://deepwiki.com/getfider/fider) -- Architecture and CQRS pattern documentation
- [Astuto GitHub](https://github.com/astuto/astuto) -- Open-source feedback tool (Rails)
- [Open Source Alternatives to Canny](https://openalternative.co/alternatives/canny) -- Comparison of open-source options
- [Featurebase: Product Management Process 2026](https://www.featurebase.app/blog/product-management-process) -- Modern feedback workflow patterns

## Recommendation

**Feedback should be a new first-class entity in Aigon, separate from research topics but with clear bridges to both research and features.**

The research strongly indicates that feedback and research serve fundamentally different purposes with different characteristics (volume, urgency, origin, lifecycle). Trying to funnel feedback through research topics would create friction: research topics are curated, low-volume, and internally-driven, while feedback is high-volume, externally-driven, and needs rapid triage.

**Recommended architecture:**

1. **New directory structure:** `docs/specs/feedback/` with kanban stages: `01-inbox/`, `02-triaged/`, `03-actionable/`, `04-done/`, `05-wont-fix/`.

2. **File-based feedback items** with YAML front matter containing: category, severity, status, reporter attribution (name, identifier, segment), source (channel, URL, date), tags, votes count, and linked-features/linked-research arrays.

3. **CLI commands:** `aigon feedback-create` (creates an inbox item with prompted metadata), `aigon feedback-triage` (AI-assisted classification, tagging, deduplication check against existing items), `aigon feedback-promote` (converts actionable feedback into a feature spec or research topic, updates bidirectional links).

4. **AI-assisted triage** as the primary value add: when triaging, the LLM reads existing feedback items, suggests classification/tags/severity, checks for duplicates by comparing against existing titles and descriptions, and recommends whether the item should become a feature, research topic, or be merged with an existing item. Human confirms.

5. **Lightweight prioritization** via optional front matter fields for RICE or ICE scores, with the CLI computing the final score. Not mandatory -- teams that want simple inbox/triaged/done can skip scoring.

6. **Bidirectional traceability** through front matter arrays: feedback items list the features/research they spawned; features/research list the feedback that motivated them. The CLI maintains both sides when promoting feedback.

**What to build first (minimum viable feedback pipeline):**
- `feedback-create` command with the front matter schema
- `feedback-triage` command with AI-assisted classification
- `feedback-promote` command to create features/research from feedback
- The directory structure and kanban stages

**What to defer:**
- RICE/ICE scoring fields (add later as optional enhancement)
- Batch import from external tools (add later as an integration feature)
- Deduplication beyond LLM-assisted title/description comparison
- Votes aggregation across multiple feedback items

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| feedback-entity-type | Create the `docs/specs/feedback/` directory structure with kanban stages (inbox, triaged, actionable, done, wont-fix) and define the YAML front matter schema for feedback items | high | none |
| feedback-create-command | Add `aigon feedback-create` CLI command that prompts for title, category, severity, reporter info, source, and tags, then writes a feedback markdown file to the inbox | high | feedback-entity-type |
| feedback-triage-command | Add `aigon feedback-triage` CLI command that uses AI to suggest classification, tags, severity, and potential duplicates for an inbox feedback item, then moves it to triaged | high | feedback-create-command |
| feedback-promote-command | Add `aigon feedback-promote` command that converts actionable feedback into a feature spec or research topic, maintaining bidirectional links in front matter on both sides | high | feedback-triage-command |
| feedback-list-command | Add `aigon feedback-list` command to display feedback items filtered by status, category, severity, or tag, with vote counts | medium | feedback-entity-type |
| feedback-attribution-schema | Define the system-agnostic reporter attribution schema (name, identifier, segment) and source schema (channel, URL, date) as part of feedback front matter | medium | feedback-entity-type |
| feedback-prioritization-fields | Add optional RICE/ICE scoring fields to feedback front matter with CLI computation of priority scores | low | feedback-entity-type |
| feedback-batch-import | Add `aigon feedback-import` command to bulk-create feedback items from a CSV or JSON file | low | feedback-create-command |
