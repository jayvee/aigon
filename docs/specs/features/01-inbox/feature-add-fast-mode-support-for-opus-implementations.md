# Feature: Add fast mode support for Opus implementations

## Summary

Allow Aigon to configure Claude Code's fast mode (2.5x faster Opus 4.6) per task type via the existing layered config system. Since Claude Code has no `--fast` CLI flag, Aigon would manage the `fastMode` setting in the user's Claude Code settings file before launching agent sessions, then restore it after. Additionally, track estimated fast mode spending per feature and enforce a configurable monthly budget with warnings, so users on Max/Pro plans don't blow through their extra usage allowance unknowingly.

## User Stories

- [ ] As a developer, I want to enable fast mode for specific task types (e.g., evaluate) so Opus runs faster during time-sensitive workflows like evaluations
- [ ] As a developer, I want fast mode config to follow the same layered override system (template < global < project < env) so I can set defaults globally but override per-project
- [ ] As a developer, I want Aigon to warn me that fast mode uses extra usage billing (not included in Max plan limits) so I'm not surprised by charges
- [ ] As a developer, I want to set a monthly fast mode budget so I can cap my extra usage spending
- [ ] As a developer, I want to see how much of my fast mode budget I've used after each feature, so I can pace my spending across the month
- [ ] As a developer, I want Aigon to block fast mode when my budget is exhausted, falling back to standard Opus instead of silently billing more

## Acceptance Criteria

- [ ] Agent config supports a `"fast"` boolean per task type alongside models, e.g. `"fast": { "research": false, "implement": false, "evaluate": true }`
- [ ] Fast mode config follows the existing layered override: template defaults < global `~/.aigon/config.json` < project `.aigon/config.json` < env vars (`AIGON_CC_<TASK>_FAST=1`)
- [ ] When launching a Claude Code session, Aigon sets `fastMode` in the Claude Code settings before launch and restores the previous value after the session ends or on interrupt
- [ ] Fast mode is only applied when the resolved model for that task type is `opus` — if model is `sonnet`, fast config is ignored with a warning
- [ ] A billing warning is shown when fast mode activates: "Fast mode enabled — billed to extra usage, not included in Max/Pro plan limits"
- [ ] `aigon doctor` reports the resolved fast mode setting per agent per task type
- [ ] Fast mode config is ignored for non-Claude agents (gg, cx, cu) — no warnings needed since it's a Claude-specific feature
- [ ] A monthly fast mode budget can be set in global or project config (e.g., `"fastBudget": { "monthly": 50, "currency": "USD" }`)
- [ ] Aigon tracks estimated fast mode spend per feature in `.aigon/fast-usage.json`, logging tokens and estimated cost after each fast mode session
- [ ] Before enabling fast mode, Aigon checks accumulated spend against the monthly budget. If exceeded, it prints a warning and falls back to standard Opus
- [ ] After a fast mode session completes, Aigon prints a spending summary: "Fast mode cost for this feature: ~$X.XX | Month to date: ~$Y.YY / $Z.ZZ (N% used, M days remaining)"
- [ ] `aigon doctor` reports the current month's fast mode spend vs budget

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

### Why settings file, not CLI flag

Claude Code has no `--fast` CLI flag. Fast mode can only be enabled via:
1. `/fast` toggle in-session (interactive, can't be scripted at launch)
2. `"fastMode": true` in the user settings file (`~/.claude/settings.json`)

Aigon should manage option 2: write `fastMode: true` before launch, restore after.

### Config shape

In `templates/agents/cc.json`:
```json
{
  "cli": {
    "models": { "research": "opus", "implement": "sonnet", "evaluate": "opus" },
    "fast": { "research": false, "implement": false, "evaluate": false }
  }
}
```

Override in `~/.aigon/config.json` or `.aigon/config.json`:
```json
{
  "agents": {
    "cc": {
      "fast": { "evaluate": true }
    }
  }
}
```

Env var override: `AIGON_CC_EVALUATE_FAST=1` or `AIGON_CC_EVALUATE_FAST=0`

### Settings management

- Read `~/.claude/settings.json` before launch
- Save the current `fastMode` value
- Set `fastMode` to the resolved value for this task type
- On session end (or SIGINT/SIGTERM), restore the original value
- Use a lockfile or atomic write to avoid races if multiple agents launch concurrently

### Key functions to modify

- `getAgentCliConfig()` (~line 1047): add fast mode resolution with same layered override pattern as models
- `buildAgentCommand()` (~line 1174): set fast mode in settings before returning command
- `buildResearchAgentCommand()` (~line 1199): same
- `feature-eval` command handler: same when launching eval sessions
- Doctor output (~line 6852): add fast mode to model display

### Budget tracking and hard limits

#### The problem

Fast mode on Max/Pro plans bills to **extra usage** — it's not included in the subscription. There's no programmatic way for an individual user to query their extra usage spend:
- The [Usage/Cost Admin API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api) requires an **organization** account with admin API keys — unavailable to individual Max subscribers
- Claude Code's `/cost` command tracks per-session API token costs, but for Max subscribers Anthropic says this "isn't relevant for billing purposes" and recommends `/stats` instead
- The only real-time view is the web dashboard at Settings > Usage on claude.ai

#### Aigon's approach: local estimation

Since we can't query actual billing, Aigon should **estimate** costs locally using known fast mode pricing:

| Context size | Input (per MTok) | Output (per MTok) |
|---|---|---|
| < 200K tokens | $30 | $150 |
| > 200K tokens | $60 | $225 |

**How it works:**

1. **Before launch**: Check `.aigon/fast-usage.json` for month-to-date spend. If over budget, warn and fall back to standard Opus.

2. **After session**: Parse Claude Code's session cost data. Claude Code logs session stats that include token counts. Aigon reads these to estimate fast mode cost for that session.

3. **Log the usage**:
```json
// .aigon/fast-usage.json
{
  "budget": { "monthly": 50, "currency": "USD" },
  "months": {
    "2026-02": {
      "total": 12.45,
      "sessions": [
        {
          "feature": "feature-23",
          "task": "evaluate",
          "date": "2026-02-15T10:30:00Z",
          "inputTokens": 150000,
          "outputTokens": 8500,
          "estimatedCost": 5.78
        }
      ]
    }
  }
}
```

4. **Print summary after each session**:
```
⚡ Fast mode cost for feature-23 evaluate: ~$5.78
📊 Month to date: ~$12.45 / $50.00 (25% used, 13 days remaining)
```

5. **Budget enforcement thresholds**:
   - **80%**: Warning — "You've used 80% of your fast mode budget with N days remaining"
   - **100%**: Block — "Fast mode budget exceeded. Falling back to standard Opus. Override with AIGON_FAST_FORCE=1"

#### Config shape for budget

In `~/.aigon/config.json` (global default):
```json
{
  "fastBudget": {
    "monthly": 50,
    "currency": "USD",
    "warnAt": 0.8,
    "hardLimit": true
  }
}
```

Override per-project in `.aigon/config.json`:
```json
{
  "fastBudget": {
    "monthly": 100
  }
}
```

Env var override: `AIGON_FAST_BUDGET=50` (monthly USD), `AIGON_FAST_FORCE=1` (bypass hard limit)

#### Limitations (be transparent about these)

- **Estimates only**: Aigon calculates cost from token counts and published pricing. Actual billing may differ slightly due to caching, rounding, or pricing changes.
- **No cross-tool tracking**: Only tracks fast mode sessions launched through Aigon. If the user toggles `/fast` manually in a standalone Claude Code session, Aigon won't see it.
- **No real-time billing API**: For individual Max users, there's no API to query actual extra usage spend. The web dashboard (Settings > Usage) remains the source of truth.

#### Future: Organization API integration

For users on Team/Enterprise plans, Aigon could optionally use the Admin API to get **actual** spend data:
```bash
curl "https://api.anthropic.com/v1/organizations/usage_report/messages?\
  starting_at=2026-02-01T00:00:00Z&\
  ending_at=2026-02-28T00:00:00Z&\
  speeds[]=fast&\
  group_by[]=model&\
  bucket_width=1d" \
  --header "anthropic-version: 2023-06-01" \
  --header "anthropic-beta: fast-mode-2026-02-01" \
  --header "x-api-key: $ADMIN_API_KEY"
```

This could replace local estimation with real billing data. Config: `"fastBudget": { "source": "api", "adminKey": "sk-ant-admin..." }`

## Dependencies

- Claude Code must be installed with a plan that supports fast mode (Pro/Max/Team/Enterprise with extra usage enabled)
- No Aigon feature dependencies

## Out of Scope

- Fast mode for non-Claude agents (not applicable)
- Toggling fast mode mid-session (Aigon only sets it at launch)
- Tracking fast mode usage from standalone Claude Code sessions not launched by Aigon
- Querying actual Anthropic billing (only estimates; dashboard remains source of truth)
- Automatic top-up or credit purchase

## Open Questions

- Should Aigon require an explicit opt-in (e.g., first-time confirmation) before enabling fast mode, given it bypasses plan limits and bills to extra usage?
- Should there be a `--fast` flag on `aigon feature-setup` / `aigon feature-eval` for one-off fast mode without changing config?
- Is settings file mutation safe when the user also has Claude Code open? (Claude Code may re-read settings on each turn)
- How accurate are token-based cost estimates vs actual billing? Should Aigon apply a safety margin (e.g., estimate at 110% of calculated cost)?
- Should the budget be shared across all projects or per-project? (Current design: global default with per-project override)
- Should Aigon parse Claude Code's session log files for actual token counts, or estimate based on typical session sizes per task type?

## Related

- [Claude Code fast mode docs](https://code.claude.com/docs/en/fast-mode)
- [Claude Code cost management](https://code.claude.com/docs/en/costs)
- [Claude Code settings](https://code.claude.com/docs/en/settings)
- [Extra usage for paid Claude plans](https://support.claude.com/en/articles/12429409-extra-usage-for-paid-claude-plans)
- [Usage and Cost Admin API](https://platform.claude.com/docs/en/build-with-claude/usage-cost-api) (org accounts only)
- `getAgentCliConfig()` in `aigon-cli.js:1047` — existing model resolution logic
- `buildAgentCommand()` in `aigon-cli.js:1174` — command construction
