# Feature: Arena Adopt Best-of-Losers on Marketing Website

## Summary
Add documentation and marketing content for the new `--adopt` flag on `feature-done` to the Aigon website. This feature allows users to cherry-pick valuable improvements from losing arena agents (extra tests, error handling, edge cases) after merging the winner.

## User Stories
- [ ] As a visitor, I can learn about the `--adopt` flag in the arena workflow documentation so I understand how to get the best from all agents
- [ ] As a visitor, I can see `--adopt` in the CLI reference / feature comparison so I understand Aigon's competitive advantage

## Acceptance Criteria
- [ ] Arena workflow section mentions `--adopt` with usage examples
- [ ] CLI reference table shows updated `feature-done` syntax including `--adopt`
- [ ] Value proposition: "Get the best from every agent, not just the winner" is communicated

## Technical Approach
- Update the arena workflow section on the marketing site to include `--adopt`
- Add a brief callout or highlight showing the adoption workflow (merge winner, review loser diffs, selectively apply)
- Update any CLI reference tables to show the new syntax

## Dependencies
- Requires `--adopt` to be shipped in the Aigon CLI (implemented in aigon repo)
