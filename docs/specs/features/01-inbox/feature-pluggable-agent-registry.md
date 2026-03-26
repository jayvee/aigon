# Feature: pluggable-agent-registry

## Summary

Create a pluggable agent registry so that new agents (Copilot CLI, Goose, future agents) can be added by dropping a single config file into `templates/agents/` with no hardcoded agent IDs anywhere in the codebase. Currently, agent IDs like `cc`, `gg`, `cx` are hardcoded in several places (`lib/git.js`, help text, Fleet examples). This feature makes the agent list fully data-driven from the config files, and includes initial configs for GitHub Copilot CLI (`gh`) and Goose (`gs`) as the first two plug-in agents.

## User Stories

- [ ] As a user, I want to add a new coding agent by creating a single JSON config file, without editing any JS source code
- [ ] As a user, I want to use GitHub Copilot CLI in Fleet mode alongside cc/gg/cx
- [ ] As a user, I want to use Goose as a cost-effective Fleet member with cheaper models
- [ ] As a developer, I want all agent IDs to come from config files so I never need to update hardcoded lists when adding agents

## Acceptance Criteria

- [ ] All hardcoded agent ID lists are replaced with dynamic lookups from `templates/agents/*.json` — specifically:
  - `lib/git.js`: `AI_AGENT_IDS`, `AI_AGENT_EMAIL_RE`, `KNOWN_AGENT_IDS` — all derived from scanning agent configs
  - Help text / example commands (e.g., `cc gg cx` in Fleet examples) — dynamically generated from available agents
- [ ] A new agent can be added by creating `templates/agents/<id>.json` with the standard schema — no other file changes required
- [ ] `templates/agents/gh.json` exists for GitHub Copilot CLI with:
  - Headless invocation: `copilot -p --autopilot "prompt"`
  - Context delivery: `.github/copilot-instructions.md`
  - Roles: `implement: true, evaluate: false, research: false, review: false` (initial conservative assignment)
- [ ] `templates/agents/gs.json` exists for Goose with:
  - Headless invocation: `goose run -t "prompt"`
  - Context delivery: recipe system
  - Roles: `implement: true, evaluate: false, research: false, review: false`
- [ ] `aigon install-agent gh` and `aigon install-agent gs` work end-to-end (generates context files, sets up headless mode)
- [ ] `aigon board` lists all agents from the registry, not a hardcoded set
- [ ] Existing agents (cc, gg, cx) continue to work identically — zero regression

## Validation

```bash
node --check aigon-cli.js
node -c lib/git.js
node -c lib/config.js
node -c lib/worktree.js
# Verify no hardcoded agent lists remain:
! grep -rn "AI_AGENT_IDS\s*=\s*\[" lib/ | grep -v "//.*deprecated"
```

## Technical Approach

### Phase 1: Remove hardcoded agent IDs

1. Add a `getRegisteredAgents()` function to `lib/config.js` that scans `templates/agents/*.json` and returns the list of agent IDs, names, and metadata
2. Replace `AI_AGENT_IDS`, `AI_AGENT_EMAIL_RE`, and `KNOWN_AGENT_IDS` in `lib/git.js` with calls to the registry
3. Replace hardcoded agent examples in help text with dynamic lists

### Phase 2: Add Copilot CLI and Goose configs

1. Create `templates/agents/gh.json` — Copilot CLI config with headless invocation, context paths, role config
2. Create `templates/agents/gs.json` — Goose config with recipe-based context, headless invocation, role config
3. Create minimal template files for each agent's context delivery:
   - `gh`: `.github/copilot-instructions.md` template
   - `gs`: recipe YAML template
4. Add install-agent support for both (context file generation, headless setup)

### Design principle

**One file = one agent.** The JSON config is the single source of truth for:
- CLI command and flags
- Headless invocation pattern
- Context delivery paths
- Supported roles
- Placeholder values for templates
- Output format and paths

## Dependencies

- depends_on: role-specific-agent-config (for the `roles` field in agent configs)

## Out of Scope

- Building custom agents from scratch (wrapping raw model APIs)
- Benchmark tracking per agent (separate feature)
- Detailed Copilot/Goose integration testing and tuning (follow-up work after initial config)

## Open Questions

- For `gh`: does `copilot -p --autopilot` support `--model` flag for model override? Need to verify during implementation
- For `gs`: what's the best way to pass aigon context via recipes vs environment variables?
- Should the registry support disabling an agent without deleting its config? (e.g., `"enabled": false`)

## Related

- Research: #21 coding-agent-landscape
- Feature: role-specific-agent-config (prerequisite)
