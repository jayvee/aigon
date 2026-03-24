# Feature: add Mistral Vibe as Aigon agent type mv

## Summary
Add Mistral Vibe (`vibe`) as a first-class Aigon agent type with ID `mv`. This replaces the Cursor (`cu`) agent slot with a cost-effective, CLI-native alternative backed by Devstral 2 — a European, independent model family. Mistral Vibe supports headless `-p` flag invocation, making it fully compatible with Aigon's worktree-based Fleet and Drive modes. The agent is registered via a new `templates/agents/mv.json` config and installed with `aigon install-agent mv`.

## User Stories
- [ ] As a developer, I can run `aigon install-agent mv` to set up Mistral Vibe as an implementation agent in my project
- [ ] As a developer, I can specify `mv` as the agent when starting a feature (`aigon feature-start <id> mv`) and Aigon spawns `vibe` in the worktree
- [ ] As a developer, Aigon's doctor command detects whether `vibe` is installed and reports it correctly

## Acceptance Criteria
- [ ] `templates/agents/mv.json` exists with correct `id`, `cli.command: "vibe"`, headless flags, and full command list
- [ ] `aigon install-agent mv` succeeds and creates `docs/agents/mistral-vibe.md`
- [ ] `agentBinMap` in `setup.js` includes `mv: 'vibe'` so `aigon doctor` checks for the binary
- [ ] `vibe -p "echo hello"` executes successfully in a worktree context (headless mode verified)
- [ ] Feature start with `mv` agent launches correctly in Drive mode
- [ ] `MISTRAL_API_KEY` is documented as a required env var in `docs/agents/mistral-vibe.md`

## Validation
```bash
node -c aigon-cli.js
node -c lib/commands/setup.js
aigon install-agent mv --dry-run 2>/dev/null || aigon install-agent mv
```

## Technical Approach

### 1. New agent config: `templates/agents/mv.json`
Model on `cu.json` (simplest agent config). Key differences:
- `id: "mv"`, `name: "Mistral Vibe"`, `aliases: ["mv", "mistral", "vibe"]`
- `cli.command: "vibe"`, `cli.implementFlag: ""` (vibe uses `-p` for headless, no extra flag needed)
- `cli.implementPrompt`: pass the feature-do prompt via `-p` flag
- No `extras.settings`, `extras.hooks`, or `extras.rules` — vibe has no equivalent config files to generate
- `output.commandDir`: not applicable (vibe has no slash-command system) — set `commands: []` or omit
- `supportsAgentsMd: true`, `agentFile: "mistral-vibe.md"`

### 2. `agentBinMap` update in `setup.js`
Add `mv: 'vibe'` to the existing `agentBinMap` object (line ~1291) so `aigon doctor` checks for the binary.

### 3. Download hint
Add `vibe: 'Install via: pip install mistral-vibe'` to the binary download hints map in `install-agent` (line ~469).

### 4. No slash commands
Mistral Vibe has no slash-command or rules system equivalent to Claude Code or Cursor. The agent receives its instructions entirely via the `-p` prompt argument. The `commands` array in `mv.json` should be empty — Aigon passes the full task prompt directly on the CLI rather than relying on in-agent slash commands.

### 5. Headless invocation pattern
Aigon currently spawns agents like: `claude --permission-mode acceptEdits /aigon:feature-do 42`
For `mv` the pattern is: `vibe -p "/aigon-feature-do 42"` or equivalent full prompt text.
The worktree spawning code in `lib/worktree.js` needs to handle agents with no slash-command support — pass the full feature-do prompt text inline via `-p`.

## Dependencies
- `vibe` CLI installed: `pip install mistral-vibe`
- `MISTRAL_API_KEY` set in environment (via `vibe --setup` or shell profile)
- Mistral La Plateforme account (scale tier for production use; experiment tier for testing)

## Out of Scope
- Mistral Vibe settings/hooks/rules file generation (vibe has no equivalent)
- Fine-tuning or model selection flags (Devstral 2 is the default and only relevant model)
- Le Chat integration (separate product, no API access)
- Aider+DeepSeek as an alternative backend (separate feature if desired)

## Open Questions
- Does `lib/worktree.js` need changes to support agents with no slash-command system, or does it already handle arbitrary `-p` prompts?
- Should `mv` support eval and review prompts, or implementation-only given Devstral 2's strengths?

## Related
- Research: Cursor replacement agents (conducted Mar 2026)
- Mistral Vibe docs: https://docs.mistral.ai/mistral-vibe/introduction
- Mistral La Plateforme: https://console.mistral.ai
- Prior agent: `cu` (Cursor) — retired due to CLI token cost structure
