# Feature: agent-registry-single-source-of-truth

## Summary
Adding or removing an agent currently requires edits across 14+ locations: `lib/templates.js`, `lib/git.js`, `lib/commands/setup.js`, `templates/profiles.json`, `templates/dashboard/index.html`, `templates/dashboard/js/actions.js`, `templates/help.txt`, two generic command templates, and several lib comments. The canonical runtime registry (`lib/agent-registry.js`, sourced from `templates/agents/*.json`) already exists — the problem is that many downstream consumers ignore it and maintain their own hardcoded lists. This feature makes `templates/agents/*.json` the single source of truth by wiring all consumers through the registry, so that adding or removing an agent means creating or deleting one file.

## User Stories
- [ ] As a maintainer adding a new agent, I want to create one `templates/agents/<id>.json` file and have the dashboard, help text, port maps, and command templates pick it up automatically — no other files to touch.
- [ ] As a maintainer retiring an agent, I want to delete one `templates/agents/<id>.json` file and have all references disappear — no grep-and-replace across the codebase.

## Acceptance Criteria
- [ ] The dashboard agent checkboxes (feature-start fleet selector) and `AGENT_DISPLAY_NAMES` / `AGENT_SHORT_NAMES` maps are derived from the live agent registry, not hardcoded in `templates/dashboard/js/actions.js`. The server injects this data (or exposes it via API) at serve time.
- [ ] `lib/templates.js` AGENT_DEFS is removed or fully delegated to `lib/agent-registry.js`; no duplicate agent metadata in `lib/`.
- [ ] Port allocations in `templates/profiles.json` are generated from agent JSON files (e.g. a `devServerPortOffset` field), or port maps are computed dynamically by `lib/profile-placeholders.js` from the registry — no hardcoded per-agent entries in `profiles.json`.
- [ ] `aigon install-agent` help and `templates/help.txt` agent list are generated from the registry, not maintained manually.
- [ ] Generic command templates (`feature-review.md`, `feature-review-check.md`) use a template placeholder (e.g. `{{AGENT_IDS}}`) substituted at install time, rather than a hardcoded agent list.
- [ ] `lib/git.js` co-author token regex is built dynamically from the registry's agent ID list, not a hardcoded alternation.
- [ ] Removing `templates/agents/mv.json` (already done) is the complete removal — a grep for `mv` in the codebase returns zero results outside of git history.
- [ ] A regression test asserts that every consumer of agent metadata (dashboard constants, port map keys, git regex alternation) contains exactly the agents present in `templates/agents/*.json` — no more, no less.

## Validation
```bash
node -c lib/agent-registry.js
node -c lib/templates.js
node -c lib/git.js
node -c lib/profile-placeholders.js
node -c templates/dashboard/js/actions.js
npm test
```

## Technical Approach
The work naturally splits into four scopes:

**1. Consolidate `lib/templates.js` AGENT_DEFS → agent-registry**
`lib/agent-registry.js` already scans `templates/agents/*.json` and provides lookup maps. `lib/templates.js` AGENT_DEFS overlaps with this — remove the duplicate and redirect callers of `AGENT_DEFS` to use registry helpers. Check what `AGENT_DEFS` currently provides that the registry doesn't (e.g. `terminalColor`, `bannerColor`, `port`) and add those fields to the JSON files if missing.

**2. Dashboard frontend: inject agent list from server, not hardcoded**
The server already knows the full agent list via `lib/agent-registry.js`. Options:
- Inject `AGENT_DISPLAY_NAMES`, `AGENT_SHORT_NAMES`, `AUTONOMOUS_AGENT_IDS` as a `<script>` block into `index.html` at serve time (simplest, no fetch round-trip).
- Or expose `/api/agents` and have the frontend fetch on load.
Prefer the injection approach — it keeps the frontend statically renderable and avoids a loading state.
The agent checkbox list in the fleet-start UI should also be generated from the injected list.

**3. Port maps in `profiles.json` → computed from agent JSON**
Add a `devServerPortOffset` (or `webPort`, `apiPort`) field to each `templates/agents/*.json`. `lib/profile-placeholders.js` builds the port map at install time by iterating registered agents. Remove per-agent entries from `profiles.json`.

**4. Text templates: replace hardcoded agent lists with `{{AGENT_IDS}}` placeholder**
`feature-review.md` and `feature-review-check.md` have prose like "cc, gg, cx, cu". Replace with `{{AGENT_IDS_SLASH_COMMAND}}` (agents that use slash commands) and `{{AGENT_IDS_SKILL}}` (agents that use skills), computed from agent JSON capability flags at install time.

`templates/help.txt` agent list section can be generated from the registry and written by `install-agent`.

`lib/git.js` regex: build the alternation string from `agentRegistry.getAllAgentIds()` at module load.

## Dependencies
- `lib/agent-registry.js` (existing registry)
- `templates/agents/*.json` (existing per-agent JSON files)
- `lib/profile-placeholders.js` (owns port placeholder injection)
- `lib/templates.js` AGENT_DEFS (to be removed)

## Out of Scope
- Changing the `templates/agents/*.json` schema in ways that break existing install logic
- Auto-generating `AGENTS.md` or `CLAUDE.md` agent sections
- Changing which agents are supported

## Open Questions
- Should `AGENT_DEFS` in `lib/templates.js` be deleted outright (callers refactored to registry) or aliased to registry output as a bridge? Deletion is cleaner but touches more call sites.
- For the dashboard injection approach: should the injected script be a literal object or a call to a server endpoint? Literal is simpler; endpoint keeps the HTML template static.
- Does `lib/git.js` building the regex dynamically introduce a startup cost worth worrying about? (Probably not — it's a tiny array join.)

## Related
- Deletion that prompted this: commit `e8905873` (chore: remove Mistral Vibe mv agent) — touched 14 files for a one-agent removal
- `lib/agent-registry.js` — existing runtime registry (already the right shape)
- `lib/profile-placeholders.js` — owns port and env placeholder injection at install time
