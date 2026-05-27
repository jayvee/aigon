# Research Findings: skill vs command format evolution

**Agent:** Cursor (cu)  
**Research ID:** 49  
**Date:** 2026-05-28

---

## Key Findings

### 1. Aigon’s model is already three layers, not two

The research brief frames “commands vs skills” as a binary split. In the codebase today there are **three distinct delivery mechanisms**, and they stack:

| Layer | What it is | Who gets it | Purpose |
|-------|------------|-------------|---------|
| **Always-on context** | `.cursor/rules/aigon.mdc` (`alwaysApply: true`), SessionStart hooks (`aigon project-context`), vendored `.aigon/docs/` | cu (and peers via their equivalents) | Lifecycle orientation without invoking a workflow command |
| **Slash commands / command files** | Full markdown playbooks from `templates/generic/commands/*.md` → `.cursor/commands/aigon-*.md` (plain, no frontmatter) | cc, gg, **cu** | Step-by-step workflow when user or harness runs `/aigon-feature-do 218` |
| **Aggregate skill manifest** | `templates/generic/skill.md` → `.claude/skills/aigon/SKILL.md` (tool list + short `system_prompt`) | cc only (installed via `extras.skill`) | Discovery of `aigon <verb>` entry points; not the full playbook |
| **Per-verb SKILL.md** | Same command template body, wrapped with `renderSkillMd()` frontmatter | cx, op, km (under `.agents/skills/aigon-<verb>/`) | Interactive Codex/OpenCode/Kimi discovery |
| **Spawn-time inline body** | `lib/agent-prompt-resolver.js` reads canonical command template, strips frontmatter, substitutes args | cx (and op launch paths that inline) | **Harness does not rely on skill discovery** for spawned feature-do/eval/review |

**Implication:** Skill-only agents are **not** limited to the 58-line aggregate `skill.md` at spawn time. Aigon already inlines the same ~50–180 line command bodies that slash-command agents get. The real gap is **mid-session nudges** (AutoConductor sends a path pointer for cx vs a slash invocation for cu) and **interactive sessions** where the operator types into the agent without going through `buildAgentLaunchInvocation`.

---

### 2. Per-agent instruction consumption (2026-05)

| Agent | `resolvesSlashCommands` | Installed workflow surface | Harness launch | Notable platform changes since Aigon’s split |
|-------|-------------------------|----------------------------|----------------|---------------------------------------------|
| **cc** | `true` | `.claude/commands/aigon/*.md` + `.claude/skills/aigon/SKILL.md` (manifest) + hooks | `/aigon:feature-do {id}` | [Claude Code merged custom commands into skills](https://code.claude.com/docs/en/skills) — `.claude/commands/` still works; `.claude/skills/*/SKILL.md` is the recommended path with auto-invocation, supporting files, `disable-model-invocation` |
| **cu** | `true` | `.cursor/commands/aigon-*.md` + `.cursor/rules/aigon.mdc` + hooks | `/aigon-feature-do {id}` | [Rules](https://cursor.com/docs/context/rules), [Commands](https://cursor.com/docs/context/commands) (chat `/`), and [Agent Skills](https://agentskills.io) (`.cursor/skills/`) coexist; forum guidance: pick by **activation** (always / glob / manual / agent-decided), not by file shape |
| **gg** | `true` | `.gemini/commands/aigon/*.toml` (prompt in TOML) + hooks | `/aigon:feature-do {id}` | Same slash pattern; prompt embedded in TOML instead of markdown |
| **cx** | `false` | 38× `.agents/skills/aigon-*/SKILL.md` + optional `.codex/config.toml` | Inline full `feature-do.md` body (not `$skill`) | [Codex Agent Skills](https://developers.openai.com/codex/skills): progressive disclosure, `$skill-name`, optional `agents/openai.yaml` for MCP deps |
| **op** | `false` | `.agents/skills/` + `.opencode/commands/` | TUI paste or `opencode run` inline | Router CLI; skill resolution descriptor-driven — Aigon inlines for reliability |
| **km** | `false` | `.agents/skills/` | TUI paste + optional skill command inject | Same family as cx for install layout |

**Cursor-specific note:** Aigon correctly treats **cu as slash-command class** (`templates/agents/cu.json`: `resolvesSlashCommands: true`, `output.format: "plain"`). The installed research-do command in this repo is a **127-line plain markdown playbook** (same canonical template as cc/cx), not a thin tool manifest. Cursor’s always-on rule duplicates high-level lifecycle pointers so agents see workflow even before `/aigon-*`.

---

### 3. Industry trend: convergence on Agent Skills, divergence on activation

**Converging:**

- **Single artifact shape:** `skill-name/SKILL.md` with YAML `name` + `description` + markdown body ([Agent Skills spec](https://agentskills.io/specification)).
- **Progressive disclosure:** metadata at startup (~100 tokens/skill), full body on activation (&lt;5000 tokens recommended), `scripts/` / `references/` on demand.
- **Commands → skills:** Claude Code explicitly merged `.claude/commands/*.md` into the skills system while keeping backward compatibility.

**Still diverging (by design):**

- **Invocation:** slash (`/deploy`), dollar (`$deploy`), tool list + CLI string (legacy Aigon `skill.md`), file inline (`$(< prompt.md)`), tmux paste.
- **Persistent rules:** `.cursor/rules`, `CLAUDE.md`, `AGENTS.md`, Gemini policies — separate from skills.
- **MCP:** JSON-RPC tools/resources/prompts ([MCP spec](https://modelcontextprotocol.org/specification/2025-11-25)) — connectivity layer, not procedural playbooks.

**Mental model (widely repeated in 2026 write-ups):** MCP = **hands** (execute/query); Skills = **brain** (how to orchestrate); Rules = **always-on constraints**. Aigon’s `aigon` CLI is already the hands; commands/skills carry the brain.

---

### 4. Does the thin manifest hurt quality?

**Evidence from this repo:**

| Scenario | Thin manifest alone? | Full playbook at session start? |
|----------|----------------------|----------------------------------|
| Aigon-spawned `feature-do` (cx) | No — resolver inlines template | Yes — same source as cu slash command |
| Aigon-spawned `feature-do` (cu) | N/A — slash opens command file | Yes |
| AutoConductor post-review nudge (cx) | Path pointer to `SKILL.md` only | Agent must read file (~100 lines) |
| Interactive Codex without spawn | Discovery may load only descriptions until `$skill` | Depends on user/agent |
| Research-35 telemetry | cx sessions dominated by **large cold-start input**; cc dominated by **cache-read** | Suggests prompt **size and restarts** matter more than manifest vs command **label** |

**Conclusion:** The measurable quality risk is **not** “cx only sees 15 tool names.” It is:

1. **Shorter or missing guidance** when the agent never loads the full SKILL body (failed discovery, wrong skill, operator never runs `$aigon-feature-do`).
2. **Mid-session injections** that point at a file instead of re-invoking a slash command (tmux paste length, operator visibility).
3. **Duplicate/conflicting** always-on docs (`AGENTS.md` + rules + hooks) vs on-demand playbooks — research-35 ranked root docs + ceremony in `feature-do` as larger token sinks than skill metadata.

No controlled A/B in this repo isolates “manifest-only vs command-only” for the same model on the same feature; brewboard/op quarantine data reflects **model + harness** issues, not format alone.

---

### 5. Can `system_prompt` in `skill.md` replace command guidance?

**Current content** (`templates/generic/skill.md`):

```yaml
system_prompt: |
  You are the Aigon Manager (ID: {{AGENT_ID}}).
  Read .aigon/docs/development_workflow.md for the full workflow.
  Read .aigon/docs/agents/{{AGENT_FILE}}.md for {{AGENT_NAME}}-specific configuration.
```

~3 lines — pointers only. The `tools:` block lists `aigon feature-do {{id}}` etc. without rubrics (branch rules, `agent-status`, commit discipline).

**Platform limits (order of magnitude):**

| Surface | Typical budget | Fit for full playbooks |
|---------|----------------|-------------------------|
| Claude `CLAUDE.md` / rules | Documented “aim &lt;200 lines” for always-on | Poor — use skills/commands on demand |
| Agent Skills `SKILL.md` body | &lt;500 lines recommended; split to `references/` | Good — **this is where command templates already land for cx** |
| Cursor rules | “Keep under 500 lines”; split composable rules | Good for invariants; not 38 workflows |
| Cursor command file | Loaded on `/` invocation | Good — **current cu path** |
| MCP tool `description` | Short string for discovery | Poor for multi-step lifecycle |

**Recommendation:** Do **not** move 50–180 line playbooks into aggregate `system_prompt`. Either keep playbooks in per-verb `SKILL.md` / command files, or add a **short invariant block** to `system_prompt` (branch check, `agent-status`, “only write findings file X”) and link to `.aigon/docs/development_workflow.md`.

---

### 6. Auto-generation: already partially implemented; should be completed

**Today:**

- **Source of truth:** `templates/generic/commands/*.md` (~39 commands, ~3432 lines total; `feature-do` ~102 lines in template).
- **install-agent** uses `formatCommandOutput()` / `renderSkillMd()` in `lib/templates.js` — one template → markdown (cc/cu), TOML (gg), or `SKILL.md` (cx/op/km).
- **Spawn path** uses `resolveCxCommandBody()` — same file, no second author.

**Gap:** `templates/generic/skill.md` (aggregate tool manifest) is **hand-maintained** and can drift from `COMMAND_REGISTRY`. cc gets both full slash commands and the manifest.

**Options:**

| Approach | Pros | Cons |
|----------|------|------|
| **A. Status quo** | Works; spawn inlines for cx | Two concepts in docs; manifest drift |
| **B. Generate `skill.md` tools[] from `COMMAND_REGISTRY`** | Single registry; cc discovery stays accurate | Still no playbook in manifest |
| **C. Deprecate aggregate manifest; rely on per-verb skills + slash** | Matches industry direction | cc users lose one-shot tool menu unless Claude lists all skills |
| **D. Extract shared `## Invariants` partial included in every template** | Cuts duplication (research-35); works across formats | Requires templating pass in install |

**Best fit:** **B + D** — registry-driven manifest + shared invariant partial; keep per-verb bodies generated from command templates (already true for cx).

---

### 7. MCP as discovery mechanism

**Viable as complement, not replacement:**

- MCP excels at **machine-callable** `aigon feature-do` with JSON schema args and dynamic status.
- It does **not** replace procedural content: eval rubrics, Fleet vs Drive branching, “do not run research-close”, Pre-authorised gates.
- Codex already supports `dependencies.tools` MCP entries in `agents/openai.yaml` per skill ([Codex skills docs](https://developers.openai.com/codex/skills)).

**For Aigon OSS:** A thin MCP server exposing lifecycle verbs would help IDEs that prefer MCP over shell; workflow playbooks should remain versioned markdown in repo (`.cursor/commands`, `.agents/skills`) for git review and `install-agent` lockstep tests (F502). **Do not** move playbook prose into MCP tool descriptions alone.

---

### 8. Minimal instruction set to match command-agent quality

For agents without reliable slash commands (cx interactive, op, km), the **minimum viable playbook** should include:

1. **Workspace invariant** — `pwd`, branch rule (feature branch vs main for research), worktree path if applicable.
2. **Lifecycle signals** — `aigon agent-status implementing` → work → `implementation-complete` / `research-complete` / `revision-complete` (explicit args if session context missing).
3. **Scope guardrails** — which files may be edited; “never move specs manually”; “never `git add .`” where fleet safety requires it.
4. **Primary action** — run `aigon feature-do <ID>` (or research-do) first for inline spec; trust inline output.
5. **Completion gate** — status command must exit 0 before claiming done (this research-do template is the reference pattern).
6. **Pointer** — `.aigon/docs/development_workflow.md` + agent-specific `.aigon/docs/agents/<id>.md` for edge cases.

Everything else (10-minute budget, iterate mode, set context, dev-server ceremony) is **high-value but compressible** into `references/` or agent-specific rules — aligns with Agent Skills progressive disclosure and research-35 “one short invariant block” finding.

**For cu:** Already at parity via slash commands + always-on rule + hooks. Further wins are **deduplication** (rule vs command vs AGENTS.md), not migrating cu to `.cursor/skills/` unless Cursor stable channel makes skills first-class for commands-only users.

---

### 9. Multi-agent orchestrators

`docs/adding-agents.md` evaluated Goose, Aider, Cline, etc. None expose a **cross-vendor instruction standard** beyond what foundation CLIs already adopt. Patterns observed:

- **Slash + repo-local markdown** (Claude Code, Cursor, Gemini) — Aigon’s primary path.
- **Router + inline prompt** (OpenCode) — Aigon inlines.
- **No emerging “one file for all agents”** other than Agent Skills and ad hoc `AGENTS.md`.

Amplify/Relay-style orchestrators generally **generate prompts per agent** rather than standardizing on a shared skill manifest — same problem Aigon solves with `templates/generic/commands` + per-agent install.

---

### 10. Cursor lens: should Aigon migrate cu from commands to skills?

| Factor | Commands (current) | Skills (Agent Skills in `.cursor/skills/`) |
|--------|-------------------|---------------------------------------------|
| Stable channel support | Yes — `.cursor/commands/` | Skills on stable per [forum](https://forum.cursor.com/t/skills-vs-commands-vs-rules/148875); verify team channel |
| Harness launch | `/aigon-feature-do` works with `resolvesSlashCommands` | Would need `/skill-name` or agent auto-select |
| Playbook size | Full markdown on invoke | Same if generated from command template |
| Always-on lifecycle | `.cursor/rules/aigon.mdc` | Still need rules for always-on |
| Cross-agent parity | Same template as cc/cx | Improves portability to Codex/Claude |

**cu recommendation:** **Stay on commands + rules for now**; add optional `.cursor/skills/aigon-feature-do/SKILL.md` generated from the same template when Cursor skills are confirmed in the user’s channel — dual-install for portability without breaking `/aigon-*` muscle memory.

---

## Sources

### Official / spec

- [Cursor Rules](https://cursor.com/docs/context/rules) — project rules, commands, AGENTS.md, 500-line guidance
- [Claude Code — Extend with skills](https://code.claude.com/docs/en/skills) — commands merged into skills
- [Agent Skills specification](https://agentskills.io/specification) — SKILL.md, progressive disclosure
- [OpenAI Codex — Agent Skills](https://developers.openai.com/codex/skills) — discovery paths, `agents/openai.yaml`, MCP dependencies
- [Model Context Protocol specification](https://modelcontextprotocol.org/specification/2025-11-25) — tools vs prompts vs resources

### Community / analysis

- [Cursor forum: Skills vs Commands vs Rules](https://forum.cursor.com/t/skills-vs-commands-vs-rules/148875)
- [Agent skills vs MCP (Ravi Chaganti)](https://ravichaganti.com/blog/agent-skills-vs-model-context-protocol-how-do-you-choose/)
- [Agent Skills for LLMs (arXiv:2602.12430)](https://arxiv.org/html/2602.12430v3) — skills + MCP as orthogonal stack

### Aigon codebase

- `templates/generic/commands/`, `templates/generic/skill.md`, `templates/generic/cursor-rule.mdc`
- `templates/agents/{cc,cu,gg,cx,op,km}.json` — `resolvesSlashCommands`, `output.format`
- `lib/agent-prompt-resolver.js` — inline vs slash vs path-pointer
- `lib/templates.js` — `renderSkillMd`, `formatCommandOutput`, `COMMAND_REGISTRY`
- `docs/adding-agents.md` — launch-type decision tree
- `docs/specs/research-topics/logs/research-35-cx-findings.md` — token sinks, cx inline launch evidence
- `CHANGELOG.md` — F277 `resolvesSlashCommands`, cu flag correction

---

## Recommendation

1. **Treat `templates/generic/commands/*.md` as the only human-edited workflow source** — continue generating agent-specific surfaces (plain md, TOML, SKILL.md) via `install-agent`.

2. **Generate aggregate `skill.md` tool entries from `COMMAND_REGISTRY`** to eliminate manifest drift on cc; keep `system_prompt` as a **short invariant + doc pointers**, not a playbook dump.

3. **Extract a shared `workflow-invariants` partial** (~30–50 lines) included in every command template and referenced from `cursor-rule.mdc` / cc skill — addresses research-35 ceremony without losing safety.

4. **Do not rely on MCP for lifecycle prose** — optional future MCP server for tool discovery only.

5. **For cu:** retain slash commands + `alwaysApply` rule; optionally dual-publish Agent Skills copies for cross-tool portability when validated on target Cursor builds.

6. **Measure before large format migration:** add telemetry comparing spawn-inline success vs interactive skill-load for cx; track `agent-status` miss rate by agent — format change should be driven by signal misses, not taxonomy.

---

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `command-registry-skill-manifest-sync` | Generate `templates/generic/skill.md` `tools:` list from `COMMAND_REGISTRY` at install time so cc’s aggregate skill never drifts from slash commands | high | none |
| `workflow-invariants-partial` | Shared template fragment (branch, agent-status, scope, completion gate) included in all command templates and always-on rules | high | none |
| `spawn-prompt-parity-contract-test` | Integration test: for each lifecycle verb, bytes of inline cx body match processed command template (regression guard for F277/b9c39a26 class) | high | none |
| `autoconductor-skill-reinvoke` | Optional config to send slash-style re-invocation for cx on review-complete when session supports `$skill` or inline snippet, instead of path-only pointer | medium | spawn-prompt-parity-contract-test |
| `cursor-dual-publish-agent-skills` | install-agent writes `.cursor/skills/aigon-<verb>/SKILL.md` from same template as `.cursor/commands/` for cross-platform portability | medium | workflow-invariants-partial |
| `aigon-mcp-lifecycle-tools` | Optional MCP server exposing feature/research verbs with JSON args; descriptions link to on-disk SKILL/command paths | low | command-registry-skill-manifest-sync |
| `instruction-format-telemetry` | Log whether session used slash, inline, or file-pointer delivery and correlate with agent-status misses | medium | none |
