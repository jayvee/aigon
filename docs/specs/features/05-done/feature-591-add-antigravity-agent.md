---
complexity: high
# agent: cc
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-25T08:12:05.662Z", actor: "cli/feature-prioritise" }
---

# Feature: add-antigravity-agent

<!-- Feature 1 of 2 in the antigravity-migration set. Independent and urgent: restores a
     working Google-model agent after Gemini CLI's 2026-06-18 shutdown. Does NOT touch gg —
     decommissioning gg is feature 2 (retire-gg-deactivated-agent), which depends on this one. -->

## Summary
Google shut down Gemini CLI for individual/free/Pro/Ultra users on 2026-06-18, replacing it with **Antigravity CLI** (binary `agy`) — a different Go-based product with a different auth model (OS keyring + `agy auth login` / `ANTIGRAVITY_TOKEN`, not an API-key env var), a different quota system, and a different plugin/hooks bundling format. This feature **adds a new `ag` (Antigravity CLI) agent** to Aigon, following the onboarding process in `docs/adding-agents.md` and the checklist in `templates/feature-template-agent-onboard.md`. It is deliberately scoped to *only* adding `ag` — the existing `gg` agent is left untouched here so this can land fast and restore a working Google-model agent. Retiring `gg` is the sibling feature `retire-gg-deactivated-agent`, which `depends_on` this one.

## User Stories
- [ ] As an Aigon user whose Gemini CLI login broke after the June 18 shutdown, I can run `aigon install-agent ag` and use Antigravity CLI as a Google-model agent in features/research/Fleet, with the core lifecycle guarantees (`aigon agent-status …`, dashboard visibility, telemetry) the roster's other agents provide.
- [ ] As a maintainer, `ag` is onboarded the same config-driven way as every other agent — no bespoke launch hacks — so it slots into the existing registry/launch/telemetry framework.

## Acceptance Criteria
- [ ] `templates/agents/ag.json` exists, fully populated per the `templates/feature-template-agent-onboard.md` checklist (Q1–Q5 answers below), and `node -e "require('./lib/agent-registry').getAgent('ag')"` exits 0.
- [ ] `.aigon/docs/agents/antigravity.md` exists, modeled on an existing agent doc (note the launch type at the top).
- [ ] `aigon install-agent ag` completes without error in a scratch test repo and produces the expected output files for `agy`'s real command/settings format (see Q2/Open Questions).
- [ ] A new assertion block for `ag` is added to `tests/integration/worktree-state-reconcile.test.js`, covering its actual launch command shape (matching its determined launch type).
- [ ] `npm run test:core` passes with `ag` wired in.
- [ ] `aigon agent-probe --quota ag` succeeds against a real Antigravity CLI install — requires the implementer to actually install `agy` and run `agy auth login` with a real Google account. (Adding the `ag` code path to `scripts/probe-agent.js` / `quota-probe` is part of this feature.)
- [ ] `ag` is added to the relevant default Fleet roster(s) in `lib/workflow-definitions.js` so it's pickable. (Leaving `gg` in place alongside it for now is fine — feature 2 removes `gg`.)

## Validation
```bash
node -e "const r=require('./lib/agent-registry'); if (!r.getAgent('ag')) { console.error('ag agent not registered'); process.exit(1); } console.log('ok');"
```

## Technical Approach

Work through `docs/adding-agents.md` Q1–Q5 using what's confirmed from public docs/announcements as of 2026-06-25 (Antigravity CLI launched 2026-05-19 — a ~5-week-old product; expect docs/behaviour to still be shifting). **The config values below are research-derived and MUST be verified against a live `agy` install before `ag.json` is locked — do not ship documentation guesses as fact.**

### Decision-tree (Q1–Q5)
- **Q1 (prompt as CLI arg)**: `agy -p "<prompt>"` exists for headless/CI use — but per the hard-disqualifier rule ("exits after completing a task" is an automatic fail), **verify `-p` doesn't exit immediately**. If `-p` is exit-on-completion, Aigon needs the equivalent of the old `gg` pattern: launch the bare interactive TUI with an auto-approve flag (candidates seen in docs: `--dangerously-skip-permissions`, `--sandbox`) and confirm the agent stays at its prompt afterward (Q4). **This determines the launch type (Slash-command vs TUI-inject) and is the single highest-risk unknown in this feature.**
- **Q2 (native `/slash` support)**: Antigravity's TUI has a `/` command menu (`/agents`, `/mcp`, `/diff`, `/rewind`), but **custom** commands moved from Gemini CLI's flat `.gemini/commands/aigon/*.toml` files to a **plugin bundle** (`plugin.json` + optional `mcp_config.json`/`hooks.json` + `skills`/`agents`/`rules` dirs, staged at `~/.gemini/antigravity-cli/plugins/<name>/`). Determine whether Aigon's `/aigon:feature-do {featureId}`-style invocation still works as a literal slash command once installed via a plugin, or whether the prompt must be delivered as plain text invoking a named skill. This drives `output.format`, `output.commandDir`, and `cli.implementPrompt`.
- **Q3 (`--model` flag)**: `agy models` (added v1.0.5) lists supported models, implying flag-based selection exists — confirm the exact flag spelling against `agy --help`. Also resolve whether "optional support for Claude and open-source backends" means cross-provider model IDs inside one agent slot (new territory for the per-agent `modelOptions` schema) or Gemini-family only.
- **Q4 (stays at own prompt after task)**: depends on the Q1 resolution.
- **Q5 (transcript telemetry)**: settings live under `~/.gemini/antigravity-cli/settings.json`; find the session-history directory and file format before setting `runtime.sessionStrategy` / `runtime.telemetryStrategy`. **Write a dedicated `ag` parser** — do not assume it can reuse the retained Gemini parser (`parseGeminiTranscripts`), though if the format turns out to be a derivative, adapting is fine.

### Config-shape decisions (grounded in existing agents — don't invent new mechanisms if one fits)
- **Auth**: Antigravity uses OS-keyring credentials via `agy auth login` (browser flow; SSH/headless prints a URL + one-time code) plus `ANTIGRAVITY_TOKEN` for CI — no API-key env var. This does **not** fit `authCheck.method: "envVar"`. Use `authCheck.method: "command"` (the `cc.json` pattern: `"command": "claude auth status"`, `"successIndicator": "loggedIn"`); find the real `agy auth status`-equivalent on a live install.
- **Trust**: check `~/.gemini/antigravity-cli/settings.json` for a trust-equivalent field. Reuse an existing `trust.type` (`claude-json`, `vscode-settings-bool`, `json-kv`, `toml-project`) if one fits, or set trust to a no-op if keyring-based auth makes a folder-trust file irrelevant — don't add a fifth trust type without need.
- **Quota error patterns**: reports describe a dual-limit system ("250-unit sprint limit" refreshing every 5 hours, "2,800-unit weekly baseline") and an `"Individual quota reached"` error string, distinct from Gemini's generic `RESOURCE_EXHAUSTED`/429. Add a dedicated `quota.errorPatterns` entry; keep a 429/rate-limit fallback. **Note:** Antigravity reportedly can't self-report remaining quota and shares one pool across desktop/CLI/SDK — so the old tmux `/model`-scrape budget mechanism likely won't port. Budget polling for `ag` is explicitly **out of scope** here (see below).
- **`installHint`/`installCommand`**: `agy` installs to `~/.local/bin/` (Unix) / `%LOCALAPPDATA%\Antigravity\` (Windows) via its own installer, not `npm i -g`. Use the real published install command/URL verbatim — don't guess an npm package name.
- **Hooks**: Antigravity carries "Hooks" forward as a first-class concept, but likely declared in a plugin's `hooks.json` rather than top-level `settings.json`. Confirm the schema before porting the standard `SessionStart` (`aigon check-version`, `aigon project-context`) and `AfterAgent` (`aigon check-agent-signal`, plus a telemetry-capture hook) definitions.

### Test contract
Add an `ag` assertion block to `tests/integration/worktree-state-reconcile.test.js` matching the determined launch type (Slash-command → quoted CLI arg + `--model` when `supportsModelFlag`; File-prompt → `$(< file)`; TUI-inject → bare launch + paste-buffer block). Copy the closest existing block.

## Dependencies
- None. This is independent of the `gg` retirement and should land **first** — it restores a working Google-model agent and gives feature 2 a replacement to swap into the Fleet rosters.

## Out of Scope
- Anything touching `gg`/Gemini — removal, deactivation, the deactivated-agent state, historic-telemetry handling. All of that is the sibling feature `retire-gg-deactivated-agent`.
- **Budget polling for `ag`** — `agy` reportedly can't self-report quota, so the tmux `/model`-scrape mechanism likely doesn't apply. Ship `ag` without budget polling; revisit separately if a quota source emerges.
- Building out Antigravity's plugin/MCP/subagent system beyond what's needed to deliver Aigon's existing feature/research/review/eval prompts. Keep using the existing `templatePath` mechanism unless Q2 shows the plugin bundle is the only way to deliver custom prompts.

## Open Questions
- Does `agy -p "<prompt>"` exit after one response, or stay interactive? Gates the whole launch-type decision (Q1/Q4); requires a live install + real Google login to answer.
- Custom-command/skill invocation mechanism (plugin-bundled skill vs literal slash command) — does `/aigon:feature-do {featureId}` survive unchanged or become a skill name?
- Session/transcript storage path and format for telemetry — and the real `agy auth status`-equivalent for `authCheck.method: "command"`.
- Does `--model <id>` work as a literal flag, and is model selection Gemini-family-only or cross-provider?

## Related
- Set: antigravity-migration
- Next in set: retire-gg-deactivated-agent (depends on this)
- Background: Google Developers Blog "Transitioning Gemini CLI to Antigravity CLI" (announced 2026-05-19, Gemini CLI shutdown 2026-06-18); `google-antigravity/antigravity-cli` GitHub repo; docs at `antigravity.google/docs/cli-*`. Researched via web search 2026-06-25 after a real `gemini auth login` failure ("This client is no longer supported for Gemini Code Assist for individuals").
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 591" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-591" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-591)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#591</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">add antigravity agent</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#592</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">retire gg deactivated age…</text><text x="336" y="90" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
