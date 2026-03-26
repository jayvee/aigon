# Feature: role-specific-agent-config

## Summary

Add role-based capability declarations to agent config files (`templates/agents/*.json`) so that each agent can declare which roles it supports (implement, evaluate, research, review). Aigon commands then use these declarations to validate agent assignments — e.g., an agent marked `implement-only` can't be assigned to evaluation. This replaces the implicit assumption that all agents can do all roles.

## User Stories

- [ ] As a user running Fleet mode, I want to assign agents only to roles they're good at, so that weak agents don't produce poor evaluations or research
- [ ] As a user adding a new agent, I want to declare its capabilities in one config file, so that Aigon automatically limits where it's used

## Acceptance Criteria

- [ ] Each agent config in `templates/agents/*.json` has a `roles` field: an object with boolean keys `implement`, `evaluate`, `research`, `review` (default all true for backward compatibility)
- [ ] `feature-start` / `research-start` in Fleet mode validate that assigned agents support the required role and warn/skip agents that don't
- [ ] `feature-eval`, `feature-review`, `research-eval` validate the executing agent supports that role
- [ ] `aigon help` or `aigon board` shows each agent's supported roles
- [ ] Existing agents (cc, gg, cx) default to all roles enabled — no behavior change without explicit config
- [ ] The `mv.json` config is updated to `implement: true, evaluate: false, research: false, review: false` as the reference example

## Validation

```bash
node --check aigon-cli.js
node -c lib/config.js
node -c lib/worktree.js
```

## Technical Approach

Add a `roles` object to the agent config schema:
```json
{
  "roles": {
    "implement": true,
    "evaluate": true,
    "research": true,
    "review": true
  }
}
```

`loadAgentConfig()` in `lib/config.js` should default missing `roles` to all-true. Validation checks go into the relevant command handlers in `lib/commands/feature.js` and `lib/commands/research.js` (entity layer if applicable). When an agent is assigned to a role it doesn't support, print a warning and skip it (don't hard-error, to avoid breaking existing workflows).

## Dependencies

- None

## Out of Scope

- Automatically detecting agent capabilities from benchmarks
- Changing which agents are available — that's the pluggable-agent-registry feature

## Open Questions

- Should there be a `default` role that gets auto-assigned when the user doesn't specify? (e.g., `implement` is the default for Fleet)

## Related

- Research: #21 coding-agent-landscape
- Feature: pluggable-agent-registry (depends on this)
