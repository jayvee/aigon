# Research Findings: explore feedback

**Agent:** Codex (cx)
**Research ID:** 04
**Date:** 2026-02-19

---

## Key Findings

1. Common feedback formats in product teams are already highly structured, but vary by source.
- Bug and request intake is often form-based (for example, GitHub Issue Forms with typed fields, required validations, labels, assignees, and issue type).
- Teams also create issues from discussions and code context, which preserves source context at intake time.
- Support platforms use typed ticket models (for example, Intercom ticket types plus ticket attributes like title/description).
- Surveys mix quantitative and qualitative inputs (for example, multiple-choice, text entry, and NPS style questions in Qualtrics).
- Usage analytics arrives as event streams with typed parameters (for example, GA4 events plus parameter metadata).

2. Feedback and research topics have different lifecycles and volume profiles.
- Feedback is continuous, high-volume, noisy, and often urgent (bugs, support pain, regressions).
- Research topics are lower-volume, curated, and hypothesis-driven.
- Treating raw feedback as research from day one adds friction and hides urgent operational triage needs.

3. Aigon should use a hybrid model: new feedback entity plus existing research/feature pipelines.
- Recommendation: add `docs/specs/feedback/` as a first-class intake and triage lane.
- Keep research and feature docs as downstream outputs that feedback can promote into.
- This preserves speed at intake while maintaining the existing Research -> Spec -> Implementation loop.

4. A lightweight triage workflow is required before promotion.
- Suggested lifecycle: `01-inbox` -> `02-triaged` -> `03-actionable` -> `04-done`, with terminal states `rejected` and `duplicate`.
- Required triage fields: `type`, `severity`, `impact`, `confidence`, `needs_info`, `duplicate_of`, `owner`.
- Open-source triage patterns (Kubernetes) and GitHub duplicate handling both show explicit triage/duplicate state is essential.

5. AI can assist triage, but human gates are still necessary.
- AI is well-suited for first-pass classification, summarization, and duplicate-candidate suggestion.
- GitHub now exposes AI issue triage guidance; Sentry shows AI-assisted issue analysis/root-cause workflows.
- Human decisions are still required for prioritization tradeoffs, roadmap alignment, and acceptance/rejection.

6. Minimum viable feedback pipeline for Aigon.
- Step 1: Create feedback items from manual input/imported text with strict front matter.
- Step 2: Triage with AI suggestions + explicit human confirm.
- Step 3: Promote selected items to research topics or feature specs.
- Step 4: Link downstream artifacts back to source feedback for traceability.

7. Traceability should be explicit and bidirectional.
- Feedback item tracks: `produced_research`, `produced_features`, `resolved_by`.
- Research/features track: `source_feedback`.
- Dependency semantics (blocked-by/blocking style) can model grouped outcomes and rollout order.

8. Attribution metadata should be system-agnostic but provenance-friendly.
- A simple front matter model should include reporter identity + source reference URL when available.
- This aligns with provenance principles (entity, agent, activity, and derivation) without binding Aigon to one external vendor.
- Proposed front matter shape:

```yaml
feedback_id: "feedback-2026-0001"
title: "Checkout button fails on Safari 18"
type: "bug" # bug | request | survey | support | analytics
status: "inbox"
priority: "high"
reporter:
  display_name: "Jane Smith"
  identifier: "jane@example.com" # email/username/external id
source:
  system: "intercom" # optional free text
  url: "https://example.com/ticket/123" # optional
  received_at: "2026-02-19T14:00:00Z"
evidence:
  summary: "Button click has no effect on Safari desktop."
  raw_ref: "files/feedback/2026-0001.txt"
```

## Sources

- GitHub Issue Forms syntax: https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/syntax-for-issue-forms
- GitHub issue creation flows (repo/comment/code/discussion/project): https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-an-issue
- GitHub duplicate handling: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues/marking-issues-or-pull-requests-as-a-duplicate
- GitHub issue dependencies: https://docs.github.com/en/issues/tracking-your-work-with-issues/using-issues/creating-issue-dependencies
- GitHub AI triage entry point: https://docs.github.com/en/issues/tracking-your-work-with-issues/administering-issues
- Jira workflows (statuses/transitions): https://support.atlassian.com/jira-software-cloud/docs/what-are-jira-workflows/
- Kubernetes issue triage guidelines (needs-triage, priority, dedupe process): https://www.kubernetes.dev/docs/guide/issue-triage/
- Intercom tickets overview: https://developers.intercom.com/docs/guides/tickets
- Intercom ticket model (ticket attributes/title/description): https://developers.intercom.com/docs/references/rest-api/api.intercom.io/tickets/enqueuecreateticket
- Qualtrics survey question formats (multiple choice, text entry, NPS): https://www.qualtrics.com/support/survey-platform/survey-module/editing-questions/question-types-guide/question-types-overview/
- GA4 events: https://developers.google.com/analytics/devguides/collection/ga4/events
- GA4 event parameters/custom dimensions: https://developers.google.com/analytics/devguides/collection/ga4/event-parameters
- W3C PROV-DM (provenance model): https://www.w3.org/TR/prov-dm/
- Sentry generative AI issue analysis (Autofix): https://docs.sentry.io/product/issues/issue-details/sentry-ai/

## Recommendation

Adopt a hybrid feedback architecture:

1. Add a new first-class `feedback` entity with its own kanban lifecycle and strict attribution metadata.
2. Keep research/feature workflows unchanged as downstream artifacts, with promotion commands from feedback.
3. Ship an MVP centered on manual ingestion + triage + promotion + traceability links, then layer AI dedupe/prioritization.
4. Require human approval at triage and promotion boundaries; AI should advise, not auto-commit roadmap decisions.

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
| feedback-entity-schema | Create `docs/specs/feedback/` structure with front matter schema, lifecycle folders, and validation rules. | high | none |
| feedback-create-command | Add `aigon feedback-create "<title>"` to create normalized feedback docs from manual input. | high | feedback-entity-schema |
| feedback-triage-command | Add `aigon feedback-triage <ID>` to classify type/severity, set status, and capture triage decisions. | high | feedback-entity-schema |
| feedback-promote-command | Add `aigon feedback-promote <ID>` to generate/link downstream research topics or feature specs. | high | feedback-triage-command |
| feedback-traceability-links | Enforce bidirectional links between feedback, research, and feature docs for auditability. | medium | feedback-promote-command |
| feedback-ai-triage-suggestions | Add AI suggestions for classification, duplicate candidates, and draft priority rationale. | medium | feedback-triage-command |
| feedback-import-batch | Add file-based import (`csv/jsonl/md`) for bulk feedback ingestion into inbox state. | medium | feedback-entity-schema |
| feedback-priority-policy | Add configurable scoring/SLA policy (severity, impact, frequency) for consistent triage decisions. | low | feedback-triage-command |
