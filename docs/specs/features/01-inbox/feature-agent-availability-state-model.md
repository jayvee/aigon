---
complexity: high
---

# Feature: agent-availability-state-model

## Summary

Add a first-class agent availability model so Aigon can distinguish between agents that are supported and active, supported but intentionally disabled by the user, not configured, temporarily quota-depleted, deprecated by Aigon maintainers, or retired from new work. Today there is a raw `agents.<id>.disabled` boolean in config, but most registry, picker, launch, recommendation, quota, and dashboard paths still treat every `templates/agents/*.json` entry as generally available. This feature should make "I can use Kimi later, but I have reduced my subscription to $0 and do not want it in my normal choices" a supported workflow without conflating it with maintainer deprecation or retired integrations.

## User Stories

- [ ] As an Aigon user, I can turn off a valid supported agent such as `km` while I am not subscribed to it, and normal start/eval/review/recommendation pickers stop offering it.
- [ ] As an Aigon user, I can turn that agent back on later without editing templates or losing my model/CLI settings.
- [ ] As an Aigon user, I can see disabled agents in a deliberate "Disabled agents" or equivalent settings area, not mixed into everyday choices.
- [ ] As an Aigon maintainer, I can mark an integration deprecated or retired in registry metadata without using a user-local config field.
- [ ] As an Aigon maintainer, I can keep retired/deprecated agents readable for historical snapshots, telemetry, attribution, old workflow state, and old session sidecars.
- [ ] As an Aigon operator, I get a clear error when I explicitly request a disabled or retired agent from the CLI, with the command needed to re-enable it when applicable.
- [ ] As a dashboard user, I do not accidentally start a feature with an agent that I have hidden or that Aigon has retired.
- [ ] As a quota user, temporary quota depletion remains separate from user preference. A quota-depleted agent is not the same thing as a disabled agent.

## Acceptance Criteria

- [ ] A canonical availability resolver exists in one module, not scattered checks. It should answer at least:
  - `getAgentAvailability(agentId, repoPath)`
  - `getUsableAgents(repoPath, options)`
  - `assertAgentUsable(agentId, repoPath, options)`
  - `formatAgentAvailabilityReason(...)`
- [ ] The resolver combines registry policy and user/project config using a documented precedence order:
  - Registry policy from `templates/agents/<id>.json` for maintainer-owned states such as `active`, `deprecated`, and `retired`.
  - Global user config for personal preference such as "subscription paused" or "hide this agent".
  - Project config for repo-local overrides when supported.
  - Runtime quota cache for temporary `quota_depleted` annotations only, not persistent preference.
- [ ] The canonical state vocabulary is implemented and documented:
  - `active`: usable and shown in normal choices.
  - `disabled`: user/project intentionally turned it off; valid integration, hidden from normal choices, can be enabled.
  - `unconfigured`: supported but missing required CLI/auth/config; not offered for launch by default.
  - `quota_depleted`: temporary runtime/cache state; may block a specific model pair but must not rewrite user preference.
  - `deprecated`: maintainer warning state; not preferred for default/recommended choices, optionally visible with warning.
  - `retired`: maintainer state; not usable for new launches, still readable for historical state.
- [ ] Existing `agents.<id>.disabled: true` remains backward-compatible and resolves as availability state `disabled`.
- [ ] New structured config is supported. Suggested shape:
  ```json
  {
    "agents": {
      "km": {
        "availability": {
          "state": "disabled",
          "reason": "subscription-paused",
          "hidden": true,
          "note": "Reduced Kimi subscription to $0",
          "updatedAt": "2026-06-25T00:00:00.000Z"
        }
      }
    }
  }
  ```
- [ ] Supported user-owned `reason` values include at least:
  - `subscription-paused`
  - `not-installed`
  - `prefer-other-agent`
  - `cost-control`
  - `manual`
  - free-form/custom reason preserved as a string
- [ ] `hidden` controls normal choice visibility. A disabled agent should default to hidden from normal pickers, but settings/doctor can still show it when intentionally viewing all agents.
- [ ] CLI commands or config affordances exist to toggle agent availability without hand-editing JSON. Acceptable command shape:
  - `aigon agent disable <agent> [--reason=<reason>] [--note=<text>] [--global|--project]`
  - `aigon agent enable <agent> [--global|--project]`
  - `aigon agent availability [--all]`
  If a different command namespace is chosen, it must be documented and tested.
- [ ] `aigon config` and dashboard settings expose the new availability controls. The UI should not require typing JSON.
- [ ] Normal agent selection surfaces use the canonical usability filter, including at least:
  - dashboard start modal
  - dashboard autonomous modal
  - dashboard schedule kickoff modal if present
  - `defaultAgent` options
  - `feature-start`
  - `feature-autonomous-start`
  - `research-start`
  - `research-autopilot`
  - `feature-eval --agent`
  - `feature-code-review --agent`
  - `feature-spec-review --agent`
  - `feature-spec-revise --agent`
  - `research-spec-review --agent`
  - `research-spec-revise --agent`
  - workflow definition agent validation
  - set autonomous agent selection
- [ ] Historical/read-only surfaces continue to accept and display old agent IDs even if currently disabled, deprecated, or retired:
  - workflow snapshots
  - `.aigon/sessions` sidecars
  - telemetry
  - attribution parsing
  - dashboard cards for already-running or already-completed work
  - `feature-open`, `session-list`, `feature-status`, detail drawers
- [ ] `agentRegistry.getAllAgents()` / `getAllAgentIds()` remain registry primitives for "known to Aigon"; a new distinct API is used for "usable for new work". This avoids breaking historical readers.
- [ ] `agentRegistry.getDefaultFleetAgents()` excludes disabled, unconfigured, deprecated-by-default, and retired agents when called for new work. If all configured defaults are filtered out, the user gets an actionable error rather than silently falling back to arbitrary agents.
- [ ] Recommendation ranking excludes disabled, unconfigured, retired, and hidden deprecated agents by default, with an explicit option to include them for diagnostics.
- [ ] Quota poller/prober does not waste work probing disabled or retired agents by default. It may include them only when explicitly requested by a refresh-all/diagnostic path.
- [ ] `doctor` reports disabled agents separately from missing/unconfigured agents. Disabled-by-user should not be treated as a problem requiring repair.
- [ ] `install-agent --all` behavior is decided and documented:
  - Either still installs all known non-retired agents because installation is not usage.
  - Or skips disabled agents by default and provides `--include-disabled`.
  The chosen behavior must be consistent and tested.
- [ ] A disabled default agent is handled clearly:
  - On read, Aigon should not silently start it.
  - Settings should surface that `defaultAgent` points to a disabled agent.
  - The user should receive a clear fix command, such as enabling the agent or changing `defaultAgent`.
- [ ] A retired agent cannot be selected for new starts even with `--include-disabled`; a separate escape hatch, if any, must be explicit and maintainer/debug-oriented.
- [ ] Deprecated agents show a warning when explicitly selected, unless a registry flag marks the deprecation as hard-blocking.
- [ ] Kimi (`km`) can be disabled with `subscription-paused` and then no longer appears in normal dashboard/CLI choices. It can be re-enabled and returns without changing `templates/agents/km.json`.
- [ ] Tests cover backward compatibility from `agents.<id>.disabled`.
- [ ] Tests cover global vs project precedence.
- [ ] Tests cover launch rejection for disabled and retired agents.
- [ ] Tests cover historical snapshot display still working for disabled/retired agent IDs.
- [ ] Tests cover recommendation/default-fleet filtering.
- [ ] Documentation is updated in the relevant user-facing configuration docs and any agent-management docs.

## Validation

```bash
node -c aigon-cli.js
node -c lib/agent-registry.js
node -c lib/config.js
npm test
```

## Technical Approach

Use separate concepts for registry policy, user preference, and runtime health:

- Registry policy answers "what does Aigon know/support?"
- User/project availability answers "what does this operator want to use here?"
- Runtime health answers "can this selected agent/model run right now?"

Do not overload workflow agent status (`running`, `ready`, `waiting`, `quota-paused`, etc.) for this. Workflow status is per feature/research slot. Availability is per agent integration and should live in config/registry/runtime capability layers.

Recommended implementation path:

1. Add an availability domain module, likely `lib/agent-availability.js`, to keep state vocabulary, precedence, formatting, and filters together.
2. Keep registry functions as known-agent APIs. Add separate helpers such as `getUsableAgentIds(repoPath, opts)` and `getPickerAgentOptions(repoPath, opts)` instead of changing `getAllAgentIds()` semantics.
3. Extend `templates/agents/*.json` schema with optional maintainer policy:
   ```json
   {
     "availability": {
       "state": "active",
       "deprecated": false,
       "retired": false,
       "defaultHidden": false,
       "reason": null,
       "message": null,
       "since": null,
       "replacementAgentIds": []
     }
   }
   ```
   Keep this minimal and prefer one canonical `state` over multiple booleans if possible.
4. Extend config support for `agents.<id>.availability`. Preserve old `disabled` reads and, if config writing touches an agent, prefer writing the new structured shape.
5. Decide scope rules:
   - User-global should be the normal scope for "I do not pay for this agent".
   - Project scope should be allowed for repo-specific policy, but user-disabled should probably win unless the user explicitly opts into a project override. This needs care because turning off billing globally should not be accidentally bypassed by a repo config.
6. Update validation in command paths so new launches call `assertAgentUsable(...)` near argument parsing. Avoid filtering historical reads.
7. Update dashboard settings schema to include availability controls. The normal agent list should show active agents first and disabled agents in a collapsed/secondary group.
8. Update recommendation and default-fleet helpers to call the usability filter for new choices.
9. Update quota polling to skip agents with resolved state `disabled` or `retired` unless explicitly requested.
10. Add docs and tests before broad UI polish. The hard part is the semantic boundary, not the toggle UI.

Suggested error copy:

```text
❌ Agent 'km' is disabled for this user: subscription-paused.
   Re-enable it with: aigon agent enable km
   Or choose another agent: aigon feature-start 42 cc
```

Suggested settings copy:

- Active agents: "Shown in normal start, review, eval, recommendation, and default-agent choices."
- Disabled agents: "Supported by Aigon, but hidden from normal choices because you turned them off."
- Deprecated agents: "Still known to Aigon, but discouraged for new work."
- Retired agents: "Preserved for old history, blocked for new work."

## Dependencies

- Existing config system in `lib/config.js`.
- Existing registry and agent template schema in `lib/agent-registry.js` and `templates/agents/*.json`.
- Existing dashboard settings schema in `lib/dashboard-settings.js`.
- Existing start/eval/review/autonomous command validation paths.
- Existing quota cache/prober in `lib/quota-probe.js` and `lib/quota-poller.js`.

## Out of Scope

- Removing any current agent template solely because it is disabled by one user.
- Changing workflow per-agent statuses such as `ready`, `running`, `waiting`, or `quota-paused`.
- Reworking model availability/quarantine beyond making sure model quarantine remains separate from agent availability.
- Building provider billing integrations or checking whether a subscription is actually paid.
- Automatically uninstalling agent command files when an agent is disabled.
- Hiding historical cards or telemetry produced by an agent that later becomes disabled or retired.
- Solving scalable agent picker layout beyond the filtering/grouping needed for availability.

## Open Questions

- Should user-global disabled always override project-level active, or should a project be allowed to re-enable an agent locally?
- Should `aigon install-agent --all` include disabled agents by default, or should it skip them unless `--include-disabled` is passed?
- Should deprecated agents be hidden by default, or visible with a warning until they are retired?
- Should `unconfigured` be inferred from doctor/auth checks only, stored in config, or both?
- Should disabled agents be excluded from quota polling always, or should the dashboard budget/quota page still probe them when visible in "all agents" mode?
- What exact dashboard control should be used: a toggle per agent, a state select, or both?
- Should the old `agents.<id>.disabled` key be migrated on write to `agents.<id>.availability.state`, or kept indefinitely as a supported alias?
- Should `defaultAgent` automatically move to another active agent when its current value is disabled, or should Aigon force the user to choose?

## Related

- Existing boolean: `lib/config.js:isAgentDisabled`
- Existing available-agent helper: `lib/templates.js:getAvailableAgents`
- Existing registry defaults: `lib/agent-registry.js:getDefaultFleetAgents`
- Existing quota state: `lib/quota-probe.js`
- Motivating example: Kimi (`km`) is a valid integration, but a user may set subscription/spend to `$0` and want it hidden until re-enabled.
- Contrast case: deprecated or retired integrations, such as agent CLIs that Aigon maintainers decide should no longer be used for new work, should be registry policy rather than user preference.
