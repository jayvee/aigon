# Feature: agent-registry-single-source-of-truth

## Summary
Adding or removing an agent currently requires edits across many locations: `lib/templates.js`, `lib/git.js`, `lib/commands/setup.js`, `templates/profiles.json`, `templates/dashboard/index.html`, `templates/dashboard/js/actions.js`, `templates/help.txt`, generic command templates, and docs/reference content. The canonical runtime registry (`lib/agent-registry.js`, sourced from `templates/agents/*.json`) already exists — the problem is that many downstream consumers ignore it and maintain their own hardcoded lists.

This feature makes `templates/agents/*.json` the single source of truth for all **operational and generated agent metadata**. Adding or removing an agent should mean creating or deleting one JSON file, then regenerating/installing outputs as needed. Historical feature specs, research logs, and changelog-style documentation are explicitly not in scope for cleanup.

## User Stories
- [ ] As a maintainer adding a new agent, I want to create one `templates/agents/<id>.json` file and have the dashboard, install flow, help text, ports, and generated agent-facing templates pick it up automatically.
- [ ] As a maintainer retiring an agent, I want to delete one `templates/agents/<id>.json` file and have operational surfaces stop mentioning it, without grep-and-replace across the codebase.
- [ ] As a maintainer updating an agent's display name, install hint, or capabilities, I want downstream consumers to reflect the change from registry data rather than separate manual edits.

## Acceptance Criteria
- [ ] The dashboard agent picker UI, display-name maps, short-name maps, and any other agent label data used by the frontend are derived from the live agent registry, not hardcoded in `templates/dashboard/js/*.js` or `templates/dashboard/index.html`. The server may inject this data at serve time or expose it via API.
- [ ] `lib/templates.js` does not own duplicate agent metadata. Any remaining compatibility layer must be a thin projection of `lib/agent-registry.js`, not a second hand-maintained source.
- [ ] Port allocations are derived from registry metadata (`portOffset` or equivalent) through shared code. `templates/profiles.json` must not contain hand-maintained per-agent port maps.
- [ ] `aigon install-agent` uses registry metadata for available agent IDs, display names, CLI names, and install hints. `lib/commands/setup.js` must not maintain a separate hardcoded install-hint map for built-in agents.
- [ ] Terminal help output (`templates/help.txt`) and generated agent help/reference content that enumerates supported agents are produced from registry data, not manually maintained agent lists.
- [ ] Generic command templates that currently embed agent families in prose or examples use explicit placeholders substituted from registry-derived groups (for example, slash-command agents vs skill-based agents) rather than hardcoded ID lists.
- [ ] `lib/git.js` co-author token regex is built dynamically from the registry's email-attribution agents, not a hardcoded alternation.
- [ ] Removing `templates/agents/mv.json` is sufficient to remove `mv` from all operational and generated surfaces: dashboard UI, help output, install-agent output, port maps, config defaults, and active agent docs/reference pages. Historical specs, logs, and research documents may still mention `mv`.
- [ ] The docs/reference surfaces that describe currently supported agents are generated from or validated against the registry. Static docs that intentionally describe historical agents are exempt.
- [ ] A regression test covers the registry contract: every consumer of agent metadata included in scope (dashboard payload, port maps, install hints, git regex inputs, help/reference output) contains exactly the agents present in `templates/agents/*.json` — no more, no less.

## Validation
```bash
node -c lib/agent-registry.js
node -c lib/templates.js
node -c lib/git.js
node -c lib/profile-placeholders.js
node -c lib/commands/setup.js
node -c templates/dashboard/js/actions.js
npm test
```

## Technical Approach
The work naturally splits into five scopes:

**1. Consolidate `lib/templates.js` AGENT_DEFS → agent-registry**
`lib/agent-registry.js` already scans `templates/agents/*.json` and provides lookup maps. `lib/templates.js` AGENT_DEFS overlaps with this — remove the duplicate and redirect callers of `AGENT_DEFS` to use registry helpers. Check what `AGENT_DEFS` currently provides that the registry doesn't (e.g. `terminalColor`, `bannerColor`, `port`) and add those fields to the JSON files if missing.

**2. Dashboard frontend: inject agent list from server, not hardcoded**
The server already knows the full agent list via `lib/agent-registry.js`. Options:
- Inject `AGENT_DISPLAY_NAMES`, `AGENT_SHORT_NAMES`, `AUTONOMOUS_AGENT_IDS` as a `<script>` block into `index.html` at serve time (simplest, no fetch round-trip).
- Or expose `/api/agents` and have the frontend fetch on load.
Prefer the injection approach — it keeps the frontend statically renderable and avoids a loading state.
The agent checkbox list in the fleet-start UI should also be generated from the injected list.

**3. Port maps in `profiles.json` → computed from agent JSON**
Reuse the existing `portOffset` field (or rename it once everywhere, but keep one field only). `lib/profile-placeholders.js` should build the port map by iterating registered agents. Remove per-agent entries from `profiles.json`.

**4. Help/install/docs surfaces: generate from registry**
`templates/help.txt`, install-agent output, and any generated agent reference/help surfaces should be built from shared registry-backed helpers. The install path should use `installHint` from each agent JSON rather than a local map in `setup.js`.

For docs, the key rule is: pages that describe the **currently supported agent set** should be generated from or validated against the registry. Historical writeups and old feature specs remain hand-authored and are out of scope.

**5. Text templates: replace hardcoded agent lists with placeholders**
`feature-review.md` and `feature-review-check.md` have prose like "cc, gg, cx, cu". Replace with `{{AGENT_IDS_SLASH_COMMAND}}` (agents that use slash commands) and `{{AGENT_IDS_SKILL}}` (agents that use skills), computed from agent JSON capability flags at install time.

`templates/help.txt` agent list section can be generated from the registry and written by `install-agent`.

`lib/git.js` regex: build the alternation string from `agentRegistry.getAllAgentIds()` at module load.

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

## Open Questions
- Should `AGENT_DEFS` in `lib/templates.js` be deleted outright (callers refactored to registry) or aliased to registry output as a bridge? Deletion is cleaner but touches more call sites.
- For the dashboard injection approach: should the injected script be a literal object or a call to a server endpoint? Literal is simpler; endpoint keeps the HTML template static.
- Does `lib/git.js` building the regex dynamically introduce a startup cost worth worrying about? (Probably not — it's a tiny array join.)
- Which docs/reference pages should be generated vs merely validated? Generating is cleaner for consistency; validation is lower churn if the site wants editorial control over prose.

## Related
- Deletion that prompted this: commit `e8905873` (chore: remove Mistral Vibe mv agent) — touched 14 files for a one-agent removal
- `lib/agent-registry.js` — existing runtime registry (already the right shape)
- `lib/profile-placeholders.js` — owns port and env placeholder injection at install time
