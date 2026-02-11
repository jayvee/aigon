# Research Findings: simplify command parameters

**Agent:** Gemini (gg)
**Research ID:** 03
**Date:** 2026-02-11

---

## Key Findings

### 1. Current Command Architecture
- **Flat Structure:** Currently, `aigon-cli.js` maps commands directly (e.g., `feature-create`, `research-conduct`). It does not support nested commands like `aigon feature create`.
- **Agent Implementation:**
  - **Gemini (`gg`)**: Commands are stored in `.gemini/commands/aigon/`, resulting in namespaced commands like `/aigon:feature-create`.
  - **Claude (`cc`)**: Commands are stored in `.claude/commands/`, resulting in flat commands like `/aigon-feature-create`.
  - **Cursor (`cu`)**: Commands are stored in `.cursor/commands/`, resulting in flat commands like `/aigon-feature-create`.
  - **Codex (`cx`)**: Commands are global prompts, resulting in `/prompts:aigon-feature-create`.

### 2. Feasibility of "Router" Command
- **Prompt-Based Router:** It is possible to create a single slash command (e.g., `/aigon:feature`) whose prompt instructs the agent to interpret the first argument (e.g., `create`) and run the corresponding CLI command (`aigon feature-create`).
  - *Pros:* No CLI changes required immediately.
  - *Cons:* Relies on the agent correctly mapping `create` -> `feature-create`. Adds latency/complexity to the prompt.
- **CLI-Based Router (Recommended):** Updating `aigon-cli.js` to natively support `aigon feature create` (dispatching to `feature-create`) would allow the slash command prompt to be extremely simple: `Run: aigon feature {{args}}`.
  - *Pros:* Robust, deterministic, simplifies agent prompts.

### 3. User Experience (UX) Trade-offs
- **Menu Clutter vs. Discoverability:**
  - *Current (Flat):* 18+ commands clutter the slash command menu. Users see everything but might be overwhelmed.
  - *Consolidated (Nested):* ~4 top-level commands (`feature`, `research`, `worktree`, `help`). Much cleaner menu.
  - *Risk:* Users might not know that `create` is a valid subcommand of `feature`.
  - *Mitigation:* The top-level command (e.g., `/aigon:feature` with no args) should print a help message listing available subcommands.

### 4. Agent Compatibility
- All four agents (Gemini, Claude, Cursor, Codex) support passing arguments to slash commands.
- Consolidating to `/aigon-feature` (or `/aigon:feature` for Gemini) is compatible with all supported agents.

## Sources

- `aigon-cli.js`: Source code analysis of command dispatch logic.
- `.gemini/commands/aigon/`: Verified existing file structure for Gemini commands.
- `templates/agents/*.json`: Verified configuration for all agents.

## Recommendation

I recommend a **hybrid consolidation approach**:
1.  **Update CLI:** Modify `aigon-cli.js` to accept `feature <subcommand>` and `research <subcommand>` as aliases for `feature-<subcommand>` and `research-<subcommand>`.
2.  **Consolidate Slash Commands:** Replace the 18+ individual command files with 3 main files per agent:
    -   `feature.md` (handles create, setup, implement, etc.)
    -   `research.md` (handles create, conduct, etc.)
    -   `worktree.md` (handles open, list)
    -   (Keep `help.md` and maybe `install-agent` as distinct if needed, or move to `aigon setup`).
3.  **Prompt Design:** The new `feature.md` prompt should be:
    -   "Run the following command: `aigon feature {{args}}`."
    -   "If no arguments are provided, list available subcommands."

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| cli-nested-commands | Update `aigon-cli.js` to support nested subcommands (e.g., `aigon feature create` -> `feature-create`). | high | none |
| consolidated-slash-commands | Replace individual slash command templates with consolidated `feature`, `research`, `worktree` templates. | medium | cli-nested-commands |
| interactive-help-prompt | Update `feature` and `research` prompts to show help if no args provided. | low | consolidated-slash-commands |