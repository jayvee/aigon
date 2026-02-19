# Research Findings: explore feedback

**Agent:** Gemini (gg)
**Research ID:** 04
**Date:** 2026-02-19

---

## Key Findings

### 1. Feedback vs. Research/Features
- **Nature**: Feedback is *raw input* (problems, wishes), whereas Research/Features are *structured outputs* (plans, specs).
- **Volume**: Feedback volume is typically 10x-100x higher than feature specs. Treating every feedback item as a "feature" would clutter the backlog.
- **Lifecycle**: Feedback needs rapid triage (acknowledge -> validate -> convert/reject). Features have a slower delivery lifecycle (design -> build -> ship).
- **Conclusion**: Feedback requires a separate entity (`docs/specs/feedback/`) to act as a "staging area" or "inbox" before items are promoted to the main roadmap.

### 2. Common Formats & Attribution
- **Formats**: Bug reports (steps to reproduce), Feature requests (problem/solution), General sentiment (surveys), Support tickets.
- **Attribution Needs**: To close the loop, we need to know *who* asked and *where* it came from.
- **Metadata Approach**: A flexible `source` schema in front matter is best for system-agnostic tracking:
  ```yaml
  source:
    channel: "github-issue" # or "email", "discord", "manual"
    author: "user-name"
    url: "https://github.com/..."
    external_id: "12345"
  ```

### 3. Triage Workflow & AI Role
- **The "Firehose" Problem**: Manual triage of raw feedback is tedious.
- **AI Opportunity**: AI agents are perfect for the first pass:
  - **Classification**: Tagging as `bug`, `feature`, `question`.
  - **Deduplication**: "This looks like existing feedback #45".
  - **Linking**: "Relates to active feature `user-auth`".
- **Workflow**:
  1.  `01-inbox`: Raw files land here.
  2.  `aigon feedback-triage`: Agent scans inbox, suggests actions (merge, convert to spec, archive).
  3.  `02-processed`: Files move here once linked to a feature/research topic or dismissed.

### 4. Traceability
- **Forward Link**: Feedback files should gain a `generated: <feature-id>` field when promoted.
- **Backward Link**: Feature specs should have `related-feedback: [<feedback-id>]` to show user demand.

## Sources

- **Feedback Driven Development**: General philosophy of using user input to drive roadmap.
- **"Inbox Zero" for Product**: methodology used by tools like Productboard or Linear's Triage.
- **Git-based Feedback**: Using markdown files for issues (similar to GitHub Issues but local/offline friendly).

## Recommendation

**Create a dedicated `docs/specs/feedback/` entity.**

This folder will serve as the "Product Inbox". It keeps the noise of raw feedback out of the rigorous `features` and `research-topics` directories until validated.

**Directory Structure:**
- `docs/specs/feedback/01-inbox/`: New items.
- `docs/specs/feedback/02-processed/`: Items that have been handled (converted to spec, merged, or rejected).

**File Format:**
Simple Markdown with front matter for attribution and status.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `feedback-create` | CLI command to generate a new feedback file from a template. | high | none |
| `feedback-triage` | AI agent command to scan inbox, summarize, and suggest links/conversions. | high | `feedback-create` |
| `feedback-link` | Utility to link a feedback item to an existing feature or research topic (updates metadata). | medium | `feedback-create` |
