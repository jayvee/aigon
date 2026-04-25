# Feature: agent-cost-awareness

## Summary

Make Aigon token-aware and plan-aware so it can advise users on agent usage costs and, over time, automatically route work to the most cost-effective agent. Each agent gets a billing plugin in its config that describes the pricing model (credit pool, token-based, API key, etc.), and Aigon tracks usage per feature and per billing cycle. During `feature-setup`, Aigon warns if an agent is approaching its limit and suggests alternatives.

## User Stories

- [ ] As a developer using Cursor (Composer 1.5) in arena mode, I want to see how much of my Pro+ credit pool I've used this cycle before committing a new feature to Cursor, so I can decide whether this feature is worth the credits
- [ ] As a developer managing multiple agents, I want Aigon to warn me when an agent is near its usage limit, so I don't discover mid-implementation that the agent is rate-limited
- [ ] As a developer, I want Aigon to suggest which agents to use based on remaining budget, so I get the best value from my subscriptions
- [ ] As a developer, I want to see per-feature cost estimates on the board, so I can understand where my credits are going

## Acceptance Criteria

- [ ] Agent configs support a new `billing` section describing the agent's pricing model
- [ ] Global user config (`~/.aigon/config.json`) stores billing cycle dates, budgets, and usage thresholds per agent
- [ ] `aigon feature-setup <ID> <agents...>` shows a cost summary before creating worktrees (cycle usage, remaining budget, agent health)
- [ ] Usage is tracked per feature in `.aigon/usage.json` — records agent ID, feature ID, estimated cost tier, and timestamp
- [ ] `aigon board` shows a cost indicator per in-progress feature (e.g., `$` / `$$` / `$$$` based on agent cost tier)
- [ ] When an agent exceeds its warning threshold, `feature-setup` displays a warning and suggests alternatives
- [ ] `aigon billing` command shows current cycle status for all configured agents
- [ ] All billing features are opt-in — disabled by default, enabled via `aigon config billing`

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Phase 1: Agent billing config + manual tracking

**New `billing` section in agent config** (e.g., `cu.json`):
```json
{
  "billing": {
    "provider": "cursor",
    "plan": "pro-plus",
    "model": "composer-1.5",
    "costTier": "high",
    "monthlyBudget": 60,
    "billingCycleDay": 9,
    "warningThreshold": 0.7,
    "errorThreshold": 0.9,
    "notes": "CLI has no Auto mode — all requests at full API rate"
  }
}
```

Cost tiers (`low` / `medium` / `high` / `premium`) are simple heuristics — no need for exact token counting. When a feature is assigned to an agent via `feature-setup`, log the assignment with the agent's cost tier.

**Global config extension** (`~/.aigon/config.json`):
```json
{
  "billing": {
    "enabled": true,
    "agents": {
      "cu": {
        "billingCycleDay": 9,
        "monthlyBudget": 60,
        "warningThreshold": 0.7
      }
    }
  }
}
```

User-level overrides merge over agent template defaults (follows existing config precedence pattern).

**Usage file** (`.aigon/usage.json`, gitignored):
```json
{
  "features": [
    { "featureId": "33", "agent": "cu", "costTier": "high", "startedAt": "2026-02-15T...", "status": "completed" },
    { "featureId": "34", "agent": "cu", "costTier": "high", "startedAt": "2026-02-20T...", "status": "completed" }
  ]
}
```

### Phase 2: Smart warnings in feature-setup

During `feature-setup`, before creating worktrees:
1. Load billing config for each requested agent
2. Count features started this billing cycle
3. If agent is past `warningThreshold`, show warning with alternatives
4. If agent is past `errorThreshold`, require `--force` to proceed

Example output:
```
💰 Agent budget check:
   cc (Claude Code)  — API key (no limit)     ✅ Ready
   cu (Cursor)       — Pro+ $60/mo (resets 3/9) ⚠️  3 features this cycle
                       Consider: cc, cx for this feature instead?

   Proceed with cu? (y/n)
```

### Phase 3: Board integration + billing command

- `aigon board` adds cost indicator column for in-progress features
- `aigon billing` shows cycle overview for all agents
- `aigon billing cu` shows detailed Cursor usage this cycle

### Phase 4 (future): Auto-routing

- `feature-setup` with no agents specified could suggest agents based on budget
- Arena mode could automatically exclude over-budget agents
- Could integrate with Cursor dashboard API if one becomes available

### Key design decisions

- **No exact token counting** — Aigon doesn't have API access to provider dashboards. Use feature count + cost tier as a proxy. Users check exact usage on provider dashboards.
- **Follows existing patterns** — billing config uses the same extras/global-config merge pattern. Usage tracking uses `.aigon/` project dir (gitignored).
- **Opt-in** — zero impact on existing workflows until explicitly configured.
- **Agent-agnostic** — the billing schema works for any agent/provider (Cursor credits, Anthropic API keys, Google API keys, etc.)

## Dependencies

- None — builds on existing agent config, global config, and feature-setup infrastructure

## Out of Scope

- Real-time token counting or API integration with provider dashboards
- Automatic spend limit management on provider side
- Cost tracking for research tasks (can be added later)
- Per-model pricing tables or token-level cost calculation

## Open Questions

- Should the cost tier be per-feature (estimated from spec size) or flat per-assignment?
- Should `aigon billing` open the provider dashboard URL in a browser?
- Should warnings block by default or just advise? (Current spec: advise at warning, require `--force` at error)

## Related

- Research: Cursor pricing model (Pro+ $60/mo, credit-based, CLI has no Auto mode)
- Feature 35: Ralph auto-submit (related — Ralph loops burn more credits per feature)
