# Feature: agent-registry-single-source-of-truth

## Summary
Adding or removing an agent currently requires edits across many locations: `lib/templates.js`, `lib/git.js`, `lib/commands/setup.js`, `templates/profiles.json`, `templates/dashboard/index.html`, `templates/dashboard/js/actions.js`, `templates/help.txt`, generic command templates, and docs/reference content. The canonical runtime registry (`lib/agent-registry.js`, sourced from `templates/agents/*.json`) already exists — the problem is that many downstream consumers ignore it and maintain their own hardcoded lists.

This feature makes `templates/agents/*.json` the single source of truth for all **operational and generated agent metadata**. Adding or removing an agent should mean creating or deleting one JSON file, then regenerating/installing outputs as needed. Historical feature specs, research logs, and changelog-style documentation are explicitly not in scope for cleanup.

## User Stories
- [ ] As a maintainer adding a new agent, I want to create one `templates/agents/<id>.json` file and have the dashboard, install flow, help text, ports, and generated agent-facing templates pick it up automatically.
- [ ] As a maintainer retiring an agent, I want to delete one `templates/agents/<id>.json` file and have operational surfaces stop mentioning it, without grep-and-replace across the codebase.
- [ ] As a maintainer updating an agent's display name, install hint, or capabilities, I want downstream consumers to reflect the change from registry data rather than separate manual edits.

## Acceptance Criteria
- [ ] The dashboard agent picker UI, display-name maps, short-name maps, autonomous/eligibility flags, and any other agent metadata used by the frontend are derived from the live agent registry, not hardcoded in `templates/dashboard/js/*.js` or `templates/dashboard/index.html`. The server-side read path is the authority for this payload; the frontend may only render/filter what the server provides and must not introduce a second hardcoded eligibility list.
- [ ] `lib/templates.js` does not own duplicate agent metadata. Any remaining compatibility layer must be a thin projection of `lib/agent-registry.js`, not a second hand-maintained source.
- [ ] Port allocations are derived from registry metadata (`portOffset` or equivalent) through shared code. `templates/profiles.json` must not contain hand-maintained per-agent port maps.
- [ ] `aigon install-agent` uses registry metadata for available agent IDs, display names, CLI names, and install hints. `lib/commands/setup.js` must not maintain a separate hardcoded install-hint map for built-in agents.
- [ ] Terminal help output (`templates/help.txt`) and generated agent help/reference content that enumerate currently supported agents are produced from registry data, not manually maintained agent lists. Historical or archival docs are exempt.
- [ ] Generic command templates that currently embed agent families in prose or examples use explicit placeholders substituted from registry-derived groups (for example, slash-command agents vs skill-based agents) rather than hardcoded ID lists. The grouping logic must live in shared generation code, not duplicated across individual templates.
- [ ] `lib/git.js` co-author token regex is built dynamically from the registry's email-attribution agents, not a hardcoded alternation. If no agents qualify, the helper must degrade safely without throwing at module load.
- [ ] Removing `templates/agents/mv.json` is sufficient to remove `mv` from all operational and generated surfaces: dashboard UI, help output, install-agent output, port maps, config defaults, and active agent docs/reference pages. Historical specs, logs, and research documents may still mention `mv`.
- [ ] The docs/reference surfaces that describe currently supported agents are generated from or validated against the registry. Static docs that intentionally describe historical agents are exempt.
- [ ] A regression test covers the registry contract: every consumer of agent metadata included in scope (dashboard payload, port maps, install hints, git regex inputs, help/reference output) contains exactly the agents present in `templates/agents/*.json` — no more, no less. The test must fail on both missing-agent and extra-agent drift.

## Validation
```bash
node -c lib/agent-registry.js
node -c lib/templates.js
node -c lib/git.js
node -c lib/profile-placeholders.js
node -c lib/commands/setup.js
node -c lib/dashboard-server.js
node -c templates/dashboard/js/actions.js
npm test
aigon install-agent cx
aigon server restart
```

Manual verification after restart:
- Confirm the dashboard renders the same agent picker/fleet-start controls without console errors and that agent labels come from the injected/runtime payload rather than template literals.
- Temporarily removing one registry file in a throwaway branch or test fixture removes that agent from generated/install surfaces without follow-up code edits.

## Technical Approach
Implement in this order so ownership stays clear and downstream surfaces can project from one source:

**1. Consolidate `lib/templates.js` AGENT_DEFS → agent-registry**
Remove `AGENT_DEFS` from `lib/templates.js`. Add `terminalColor`, `bannerColor`, and `portOffset` fields to the JSON schema in `templates/agents/*.json`. Redirect all callers of `AGENT_DEFS` to use `lib/agent-registry.js` lookup helpers.

**2. Add one shared projection layer for downstream consumers**
If existing consumers need slightly different shapes, add a shared projection/helper layer next to `lib/agent-registry.js` rather than letting each module reshape raw registry data independently. This is the only acceptable compatibility layer.

**3. Dashboard frontend: inject agent list from server, not hardcoded**
In `lib/dashboard-server.js`, inject a `<script>` block defining `window.__AIGON_AGENTS__` into `index.html` at serve time. This payload must include each agent's `id`, display name, short name, and autonomous/eligibility flags derived from `lib/agent-registry.js`. Update `templates/dashboard/js/actions.js` and the fleet-start UI to iterate over `window.__AIGON_AGENTS__` instead of hardcoded lists.

**4. Port maps in `profiles.json` → computed from agent JSON**
Standardize on the `portOffset` field in agent JSON files. Update `lib/profile-placeholders.js` to build the port map dynamically by iterating over registered agents. Delete all per-agent hardcoded port entries from `templates/profiles.json`.

**5. Help/install/docs surfaces: generate from registry**
Update `lib/commands/setup.js` to read `installHint` from the agent JSON via the registry rather than a local map. Generate `templates/help.txt` agent lists using registry-backed helpers during `install-agent`.

**6. Text templates: replace hardcoded agent lists with placeholders**
Update `feature-review.md` and `feature-review-check.md` to replace hardcoded lists (e.g., "cc, gg, cx, cu") with `{{AGENT_IDS_SLASH_COMMAND}}` and `{{AGENT_IDS_SKILL}}`. Compute these placeholders at install time based on capability flags in the agent JSON files.
Update `lib/git.js` to dynamically build the `co-author` alternation regex using `agentRegistry.getAllAgentIds()` at module load.

## Agent Viability Checklist

Before an agent can be added to `templates/agents/`, it must satisfy the minimum requirements that make Aigon's workflow actually function. Mistral Vibe (`mv`) was added and later removed because it failed several of these. This checklist lives in the spec so it travels with the registry work and is enforced at PR time.

### Hard requirements (agent cannot be added without these)

1. **Headless / non-interactive launch** — the agent CLI must be spawnable from a shell script without a TTY and must accept a prompt string as a flag or argument (e.g. `--prompt`, `-p`, positional). This is how `buildAgentCommand()` in `lib/worktree.js` launches it inside tmux.

2. **Context delivery mechanism** — Aigon must have a way to inject its command prompt into the agent's context before it runs. Acceptable forms:
   - **SessionStart hook** (like cc/gg): the agent exposes a hook that runs a shell command at session start; `aigon project-context` prints the doc pointers.
   - **Slash commands / skills** (like cc/gg/cx): the agent discovers and executes aigon's command files (`.claude/commands/`, `.agents/skills/`, etc.).
   - **Inline prompt injection** (like cx): aigon inlines the full command body into the launch prompt so the agent receives it directly.
   Without one of these, the agent won't know what feature to work on or follow the workflow.

3. **Exit on completion** — the agent process must exit when it finishes its task. Agents that stay open in an interactive REPL block the shell trap signal that tells Aigon the work is done.

4. **Trust / permissions model** — the agent must have a way to grant Aigon's file paths appropriate access (read/write to spec files, worktree, etc.) without requiring interactive approval mid-session. This is typically configured in the agent's settings or policy file.

### Strong preferences (absence is a yellow flag, not a hard block)

5. **Shell trap signal support** — the agent's process lifecycle should be compatible with bash `trap EXIT` so `agent-status submitted/error` fires reliably when the session ends. Agents with unusual process trees (daemonised subprocesses, wrapper scripts that swallow the exit code) may not fire the trap correctly.

6. **Cost/telemetry visibility** — Aigon parses transcript or session files to record token spend. If the agent produces no parseable cost data, telemetry will be blank. Not a blocker but makes cost tracking blind for that agent.

7. **Bench performance** — mv scored 25–28/40 vs gg's 32–38/40 on identical features. An agent that can't reliably follow a multi-step spec is a poor fit regardless of whether the plumbing works.

### What to put in the agent JSON

The `templates/agents/<id>.json` file should record which of the above capabilities the agent has, using fields already present in the schema (`signals`, `capabilities`, `contextDelivery`). This makes it machine-checkable: `aigon doctor` can warn if a registered agent lacks a required capability field.

At minimum, the registry entry used by this feature must continue to supply or derive the fields needed by current consumers: identity (`id`, display name, CLI/install naming), install hints, attribution/email behavior, dashboard labels/eligibility flags, and `portOffset`.

## Dependencies
- `lib/agent-registry.js` (existing registry)
- `templates/agents/*.json` (existing per-agent JSON files)
- `lib/profile-placeholders.js` (owns port placeholder injection)
- `lib/templates.js` AGENT_DEFS (to be removed)

## Out of Scope
- Changing the `templates/agents/*.json` schema in ways that break existing install logic
- Auto-generating `AGENTS.md` or `CLAUDE.md` agent sections
- Changing which agents are supported
- Rewriting historical specs, research logs, or changelog-style docs to erase references to removed agents

## Decisions / Remaining Questions
- Decision: `AGENT_DEFS` should stop being a hand-maintained source. A temporary compatibility export is acceptable only if it is mechanically projected from `lib/agent-registry.js`.
- Decision: the dashboard should use a server-injected payload for this feature rather than introducing a new endpoint. That keeps the change scoped to replacing hardcoded frontend data, not redesigning dashboard transport.
- Open question: which docs/reference pages should be fully generated vs merely validated against the registry? The implementation should enumerate the chosen surfaces in the PR so the boundary is explicit.

## Related
- Deletion that prompted this: commit `e8905873` (chore: remove Mistral Vibe mv agent) — touched 14 files for a one-agent removal
- `lib/agent-registry.js` — existing runtime registry (already the right shape)
- `lib/profile-placeholders.js` — owns port and env placeholder injection at install time
