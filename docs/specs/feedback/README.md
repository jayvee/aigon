# Feedback Specs

Feedback captures raw user/customer input before it becomes research or a feature.

## Lifecycle

- `01-inbox`: New feedback awaiting triage
- `02-triaged`: Categorized and validated feedback
- `03-actionable`: Ready to convert into research/features
- `04-done`: Resolved and closed
- `05-wont-fix`: Reviewed and intentionally not actioned
- `06-duplicate`: Duplicate feedback linked to a canonical item

## Filename Convention

- `feedback-<ID>-<slug>.md`
- `ID` is numeric and stable once assigned

## Front Matter Schema

Required fields:
- `id`: Numeric feedback ID
- `title`: Short human-readable summary
- `status`: Lifecycle status (must match folder)
- `type`: Feedback category (for example `bug`, `feature-request`, `ux`, `performance`)
- `reporter`: Attribution object for who provided the feedback
- `source`: Provenance object for where feedback came from

Optional fields:
- `severity`: Relative impact/urgency
- `tags`: Search/filter labels
- `votes`: Integer signal count
- `duplicate_of`: Canonical feedback ID when duplicate
- `linked_features`: Feature IDs created from this feedback
- `linked_research`: Research IDs created from this feedback

Example `reporter` object:

```yaml
reporter:
  name: "Jane Doe"
  identifier: "jane@example.com"
```

Example `source` object (system-agnostic; `url` is optional):

```yaml
source:
  channel: "support-ticket"
  reference: "TICKET-1234"
  url: "https://example.com/tickets/TICKET-1234"
```
