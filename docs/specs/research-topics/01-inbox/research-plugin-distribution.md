# Research: plugin-distribution

## Context

Aigon currently distributes itself to AI coding agents via `aigon install-agent`, which generates agent-specific command files from a unified template system. As agent ecosystems mature and develop native plugin/extension marketplaces, we need to evaluate whether Aigon should be distributed as a native plugin for each agent, continue with the current CLI + template approach, or adopt a hybrid strategy.

The core tension: Aigon's value is **cross-agent orchestration** (arena mode, shared specs, unified workflow), but plugin systems are inherently **per-agent silos**.

## Questions to Answer

- [x] What plugin/extension systems exist for each supported agent (Claude Code, Cursor, Gemini CLI, Codex)?
- [x] What plugin/extension systems exist for potential future agents (Cline, Windsurf, GitHub Copilot, Aider)?
- [x] Should Aigon be distributed as a native plugin for any agent?
- [x] What would be gained and lost by plugin distribution vs. the current CLI approach?
- [x] Is MCP (Model Context Protocol) a viable universal adapter?
- [x] What is the recommended distribution architecture going forward?

## Scope

### In Scope
- Plugin/extension ecosystem analysis for all current and potential agents
- Distribution strategy recommendation
- MCP server feasibility as universal adapter
- Migration complexity assessment per agent
- Impact on cross-agent orchestration (arena mode)

### Out of Scope
- Implementation of MCP server or plugin shims
- Pricing or licensing considerations for marketplaces
- Non-coding-agent distribution (IDE extensions, web apps)
- Changes to the core CLI architecture

## Findings

### Current Aigon Distribution Model

Aigon integrates with agents through a template system:
1. Source templates in `templates/generic/commands/` (18 commands)
2. Agent configs in `templates/agents/{id}.json` define output format, placeholders, directory structure
3. `aigon install-agent` generates agent-specific files (Markdown, TOML, plain text)
4. Generated files are gitignored; re-generated on `aigon update`
5. `<!-- AIGON_START/END -->` markers preserve user content during regeneration

All generated commands delegate to the `aigon` CLI for actual logic. The commands are instruction wrappers, not self-contained logic.

### Agent Plugin Ecosystem Analysis

#### 1. Claude Code (currently supported as `cc`)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | Native plugin system with `plugin.json` manifest |
| **Components** | Commands, Skills, Subagents, Hooks, MCP servers, LSP servers |
| **Marketplace** | Decentralized model; community registries (claude-plugins.dev, 270+ plugins) |
| **Installation** | `/plugin install <name>` |
| **Distribution** | GitHub repos, npm registry, git URLs, local paths |

**Extension Mechanisms:**
- **Custom Slash Commands** (`commands/`): Markdown files, user-triggered via `/command-name`
- **Skills** (`skills/`): Agent-invoked capabilities with YAML frontmatter and conditions
- **Subagents** (`agents/`): Specialized AI agents in isolated contexts
- **Hooks** (`hooks/hooks.json`): Lifecycle handlers (PreToolUse, PostToolUse, SessionStart, etc.) with command, prompt, and agent handler types
- **MCP Servers** (`.mcp.json`): External tool integrations with OAuth and lazy loading
- **LSP Servers** (`.lsp.json`): Language-specific code intelligence

**Hook Events Available:** SessionStart, UserPromptSubmit, PreToolUse, PermissionRequest, PostToolUse, PostToolUseFailure, Notification, SubagentStart, SubagentStop, Stop, PreCompact, SessionEnd

**Sources:**
- [Create plugins - Claude Code Docs](https://code.claude.com/docs/en/plugins)
- [Claude Code Plugins & Agent Skills Registry](https://claude-plugins.dev/)
- [Create and distribute a plugin marketplace](https://code.claude.com/docs/en/plugin-marketplaces)

---

#### 2. Cursor (currently supported as `cu`)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | Rules system + VS Code extension compatibility |
| **Components** | Rules files (`.cursorrules`, `.cursor/rules/`), VS Code extensions |
| **Marketplace** | No cursor-specific plugin marketplace; community rules at cursorrules.org |
| **Installation** | Manual file placement or VS Code extension install |
| **Distribution** | Community-shared rule sets, VS Code Marketplace |

**Extension Mechanisms:**
- **Project Rules** (`.cursor/rules/`): Path-specific configurations for AI behavior
- **Legacy Rules** (`.cursorrules`): Single-file project rules (deprecated in favor of Project Rules)
- **VS Code Extensions**: Full compatibility with VS Code extension marketplace
- **Slash Commands** (`.cursor/commands/`): Plain Markdown files accessed via `/` in Agent input

**Key Limitation:** No formal plugin architecture for CLI workflow tools. Rules are for prompt injection, not command declaration.

**Sources:**
- [Rules | Cursor Docs](https://cursor.com/docs/context/rules)
- [Cursor Rules Best Practices](https://cursorrules.org/)

---

#### 3. Gemini CLI (currently supported as `gg`)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | Native extensions system |
| **Components** | Prompts, MCP servers, Agent Skills |
| **Marketplace** | Extension gallery at geminicli.com/extensions |
| **Installation** | `gemini extensions install <github-url>` or local path |
| **Distribution** | GitHub URLs, local paths, extension gallery |

**Extension Mechanisms:**
- **Extensions**: Bundles of prompts, MCP servers, and skills
- **MCP Server Configurations**: Connect to external tools and APIs
- **Agent Skills**: Bundled in extensions' `skills/` subdirectory
- **Extension Management**: CLI commands for install, list, manage

**Key Partners with Extensions:** Dynatrace, Elastic, Figma, Harness, Postman, Shopify, Snyk, Stripe

**Sources:**
- [Gemini CLI Extensions Documentation](https://geminicli.com/docs/extensions/)
- [Getting Started with Gemini CLI Extensions](https://codelabs.developers.google.com/getting-started-gemini-cli-extensions)
- [Gemini CLI Extensions Gallery](https://geminicli.com/extensions/)

---

#### 4. Codex (currently supported as `cx`)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | None (limited prompt-based customization) |
| **Components** | Global prompts (`~/.codex/prompts/`), TOML config |
| **Marketplace** | None |
| **Installation** | Manual file placement |
| **Distribution** | N/A |

**Extension Mechanisms:**
- **Global Prompts**: Custom slash commands via `~/.codex/prompts/` (shared across all projects)
- **TOML Configuration**: `.codex/config.toml` for behavior settings
- **Project Prompts**: `.codex/prompt.md` for project-level instructions

**Key Limitation:** Most limited extension ecosystem. No formal plugin architecture; relies entirely on prompt-based customization.

---

#### 5. Cline (potential future agent)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | MCP-based extensions |
| **Components** | MCP servers for capability extension |
| **Marketplace** | VS Code Marketplace, JetBrains Marketplace |
| **Installation** | Standard marketplace install |
| **Distribution** | IDE marketplaces |

**Notes:** Open source (57k+ GitHub stars), autonomous multi-step agent, full MCP server support for plugins. Strong candidate for MCP-based Aigon integration.

**Sources:**
- [Cline - VS Code Marketplace](https://marketplace.visualstudio.com/items?itemName=saoudrizwan.claude-dev)
- [Cline GitHub Repository](https://github.com/cline/cline)

---

#### 6. Windsurf (potential future agent)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | Native editor + JetBrains plugin |
| **Components** | Language server, agentic capabilities |
| **Marketplace** | IDE-native marketplaces |
| **Installation** | IDE plugin install |
| **Distribution** | IDE marketplaces |

**Notes:** Full features in native editor and JetBrains plugin. Other IDE plugins (VS Code, Vim, NeoVim, Jupyter) are in maintenance mode. Too different from Aigon's file-based approach for practical plugin integration.

**Sources:**
- [Windsurf Plugins Documentation](https://docs.windsurf.com/plugins/getting-started)

---

#### 7. GitHub Copilot (potential future agent)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | GitHub Copilot Extensions marketplace |
| **Components** | Agent-based extensions, API plugins, Copilot connectors |
| **Marketplace** | Official GitHub Marketplace (~30 extensions) |
| **Installation** | Marketplace install |
| **Distribution** | GitHub Marketplace |

**Partners:** DataStax, Docker, Lambda Test, LaunchDarkly, Pinecone, Sentry, and others. Also supports private extensions for organizations.

**Sources:**
- [GitHub Copilot Extensions Marketplace](https://github.com/marketplace?type=apps&copilot_app=true)

---

#### 8. Aider (potential future agent)

| Aspect | Detail |
|--------|--------|
| **Plugin System** | None (feature request exists: issue #973) |
| **Components** | 3rd party IDE extensions only |
| **Marketplace** | Community VS Code/JetBrains extensions |
| **Installation** | IDE extension install |
| **Distribution** | Community-created |

**Notes:** Terminal-based tool. No formal plugin architecture. Would need template-based integration similar to current Aigon agents.

**Sources:**
- [Aider Plugin Feature Request](https://github.com/paul-gauthier/aider/issues/973)

---

### Cross-Platform Technology: MCP (Model Context Protocol)

MCP is emerging as the universal standard for agent extension:

- **Supported by:** Claude Code, Cline, Cursor (with MCP support), Gemini CLI, VS Code, JetBrains IDEs, OpenAI Agents SDK, Microsoft Copilot Studio
- **Capabilities:** Resources (file-like data), Tools (callable functions), Prompts (templates)
- **Benefits:** One implementation serves all MCP-capable agents
- **Relevance to Aigon:** The existing skill definition in `templates/generic/skill.md` already defines typed tool interfaces (e.g., `aigon_feature_setup_arena`, `aigon_feature_implement`) that map directly to MCP tool definitions

### Summary Comparison Table

| Agent | Plugin System | MCP Support | Marketplace | Aigon Plugin Viable? |
|-------|---------------|-------------|-------------|---------------------|
| **Claude Code** | Native (mature) | Yes | Yes (decentralized) | Thin shim only |
| **Cursor** | Rules only | Emerging | No | No |
| **Gemini CLI** | Native (new) | Yes | Yes (gallery) | Thin shim only |
| **Codex** | None | No | No | Impossible |
| **Cline** | MCP-based | Yes | IDE marketplaces | Via MCP server |
| **Windsurf** | Native editor | Emerging | IDE marketplaces | No (too different) |
| **GitHub Copilot** | Marketplace | Emerging | GitHub Marketplace | Possible (future) |
| **Aider** | None | Community | None | Impossible |

### The Fundamental Architecture Conflict

Aigon's architecture is inherently **cross-agent** and **project-level**. A typical arena session:

```
aigon feature-setup 55 cc gg cx
  -> Creates 3 git worktrees
  -> Creates 3 branches
  -> Creates 3 implementation log templates
  -> Commits spec move to main
  -> Configures ports per agent

aigon feature-eval 55
  -> Reads all 3 implementations
  -> Generates comparison template

aigon feature-done 55 cx
  -> Merges winner's branch
  -> Archives logs (selected vs alternatives)
  -> Cleans up worktree
```

This workflow spans multiple agents, multiple git branches, multiple directories, and multiple file-system locations. No single agent's plugin system can encompass this.

### Per-Agent Migration Analysis

| Agent | Gain from Plugin | Loss from Plugin | Complexity | Verdict |
|-------|-----------------|-----------------|------------|---------|
| **Claude Code** | Discoverability, one-step install, auto-updates | Cross-agent orchestration, template customization, marker system | Medium | Thin shim only (after marketplace matures) |
| **Cursor** | None | N/A | N/A | Current approach is correct and only option |
| **Gemini CLI** | Gallery discoverability | Template synchronization, cross-agent coordination | Low-Medium | Thin shim only (low priority) |
| **Codex** | None possible | N/A | N/A | No plugin system exists |

### Risks of Plugin Migration

1. **Fragmentation of maintenance**: Updating `templates/generic/commands/feature-implement.md` currently propagates to all 4 agents via `aigon update`. Per-agent plugins need separate release cycles.
2. **Loss of cross-agent identity**: Aigon's arena mode only makes sense as a unified concept. Per-agent plugins obscure this.
3. **Plugin sandbox restrictions**: Aigon creates git worktrees, spawns terminal sessions, writes to arbitrary project directories, and modifies agent settings. Plugin sandboxes may restrict these operations.
4. **Dependency inversion**: Today Aigon controls installation. With plugins, each agent's plugin system controls installation, and Aigon loses ability to ensure consistent cross-agent setup.
5. **Hook system incompatibility**: Aigon's hook system (parsing `docs/aigon-hooks.md`, running pre/post hooks with environment variables) is tied to CLI execution and cannot be replicated in plugins.

## Recommendation

### Strategy: CLI Core + MCP Server + Thin Plugin Shims

**Do not make Aigon a native plugin for any agent.** Keep the current CLI + template architecture as the primary distribution mechanism. Layer two complementary distribution channels on top:

### Tier 1: CLI remains the source of truth (unchanged)

The `aigon` CLI handles all state transitions, git operations, worktree management, hooks execution, and cross-agent coordination. No plugin system can replace it.

### Tier 2: Template system remains for command generation (unchanged)

The `templates/generic/commands/` directory with agent-specific placeholder resolution is an elegant one-source-of-truth design. Each agent config declares its output format, frontmatter requirements, directory structure, and placeholder syntax. This must be preserved.

### Tier 3: MCP server as universal plugin adapter (NEW -- high priority)

Build `aigon-mcp-server` that wraps the `aigon` CLI commands as MCP tools. Any MCP-capable agent (Claude Code, Cline, Cursor, Gemini) can consume it. Benefits:
- One implementation, many consumers
- Maintains cross-agent orchestration (MCP server calls the same CLI)
- No fragmentation of the template system
- Existing skill definitions in `templates/generic/skill.md` already define the tool interface

### Tier 4: Marketplace shims for discoverability (OPTIONAL -- low priority)

For agents with marketplaces (Claude Code plugins, Gemini extensions), create ultra-thin distribution packages that:
1. Declare Aigon's existence in the marketplace
2. Run `npm install -g aigon && aigon install-agent <agent>` on install
3. Delegate all actual functionality to the CLI

These shims add no logic. They are discovery vehicles.

### What to Keep as CLI vs. What to Expose via MCP

| Capability | Keep in CLI | Expose via MCP |
|---|---|---|
| `aigon init` | Yes | No |
| `aigon install-agent` | Yes | No |
| `aigon update` | Yes | No |
| `aigon config` | Yes | No |
| `aigon feature-create` | Yes (core logic) | Yes (thin tool) |
| `aigon feature-setup` | Yes (core logic) | Yes (thin tool) |
| `aigon feature-implement` | Yes (core logic) | Yes (thin tool) |
| `aigon feature-done` | Yes (core logic) | Yes (thin tool) |
| `aigon feature-eval` | Yes (core logic) | Yes (thin tool) |
| `aigon feature-list` | Yes (core logic) | Yes (thin tool) |
| `aigon worktree-open` | Yes (core logic) | Yes (thin tool) |
| `aigon hooks` | Yes | No |
| Template generation | Yes | No |
| Cross-agent coordination | Yes | No |

### Implementation Priority

| Phase | Action | Priority |
|-------|--------|----------|
| **Phase 1** | Build `aigon-mcp-server` wrapping CLI commands as MCP tools | High |
| **Phase 2** | Claude Code plugin shim (after marketplace matures) | Medium |
| **Phase 3** | Gemini CLI extension shim | Low |
| **Phase 4** | Never: do not create plugins for Codex or Cursor | N/A |

## Output
- [ ] Feature: MCP server wrapping aigon CLI commands
- [ ] Feature: Claude Code plugin shim for marketplace distribution
