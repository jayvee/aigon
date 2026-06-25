---
complexity: medium
# agent: cc    # optional — id of the agent that owns this research spec;
#              #   see feature-template.md for precedence rules.
# origin: customer-feedback   # optional — set when input came from user/customer voice (vs agent discovery)
# reporter:                   # optional — who reported it (when origin is customer-feedback)
#   name: ""
#   identifier: ""
# source:                     # optional — where the input came from
#   channel: ""
#   reference: ""
#   # url: "https://example.com/ticket/123"
# feedback_refs:              # optional — stable refs to migrated legacy feedback (idempotency)
#   - feedback:12
#   - docs/specs/feedback/01-inbox/feedback-12-example.md
---

# Research: {{NAME}}

<!-- Authoring AI: set `complexity:` using the same rubric as features —
     low/medium/high/very-high — based on breadth of investigation and judgment
     required. Model/effort defaults at start come from each agent's
     `cli.complexityDefaults[<complexity>]` (not from this spec). -->

## Context
<!-- Why is this research needed? What problem or opportunity prompted it? -->

## Questions to Answer
<!-- List specific questions this research should answer -->
- [ ]
- [ ]

## Scope

### In Scope
-

### Out of Scope
-

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
