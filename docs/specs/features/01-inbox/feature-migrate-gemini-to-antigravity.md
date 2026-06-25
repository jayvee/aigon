---
complexity: high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: migrate-gemini-to-antigravity

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file changes, new public surfaces, judgment-heavy deletion work
       very-high — architectural shifts, contract-breaking changes, new invariants, cross-cutting work that spans multiple subsystems
     At start time, model and effort defaults come from each agent's complexity-defaults
     table (not from this spec). Do not put model IDs in the spec. -->

## Summary
Google shut down Gemini CLI for individual/free/Pro/Ultra users on 2026-06-18, replacing it with **Antigravity CLI** (binary `agy`) — a different Go-based product with a different auth model (OS keyring + `agy auth login` / `ANTIGRAVITY_TOKEN`, not an API-key env var), a different quota system (dual sprint/weekly limits, no self-throttling), and a different plugin/hooks bundling format. Per maintainer decision, this feature **removes** the `gg` (Gemini CLI) agent entirely and **adds** a new `ag` (Antigravity CLI) agent in its place, following the existing onboarding/decommission patterns in `docs/adding-agents.md` and `templates/feature-template-agent-onboard.md`. Enterprise users on Gemini Code Assist Standard/Enterprise (via Google Cloud) are explicitly out of scope — Google says their access is unaffected, but Aigon is dropping the `gg` slot regardless per maintainer call.

## User Stories
- [ ] As an Aigon user whose Gemini CLI login broke after the June 18 shutdown, I can run `aigon install-agent ag` and use Antigravity CLI as my Google-model agent in features/research/Fleet, with the same lifecycle guarantees (`aigon agent-status ...`, dashboard visibility, telemetry, budget polling) that `gg` used to provide.
- [ ] As an Aigon maintainer, I no longer see `gg`/Gemini referenced anywhere in active code, docs, or tests — there is no dead config pointing at a CLI that no longer authenticates for our users.

## Acceptance Criteria
- [ ] `templates/agents/gg.json` is deleted; `node -e "require('./lib/agent-registry').getAgent('gg')"` returns undefined/null (not a thrown crash from stale references elsewhere).
- [ ] `.aigon/docs/agents/gemini.md` is deleted.
- [ ] All `gg`/`gemini` references in `AGENTS.md`, `docs/adding-agents.md`, `CONTRIBUTING.md`, and `tests/integration/worktree-state-reconcile.test.js` are removed or replaced with `ag`/Antigravity equivalents (see Technical Approach for the known site list).
- [ ] Gemini-specific parsing code (`parseGeminiTranscripts()` in `lib/telemetry.js`, the `gemini-chats` branch in `lib/session-sidecar.js`, `presetGeminiTrust()` / `gemini`-specific branches in `lib/worktree.js`, the `capture-gemini-telemetry` hook command in `lib/commands/misc.js`) is either removed or repurposed for `ag` — not left as orphaned dead code referencing a deleted agent.
- [ ] `templates/agents/ag.json` exists, fully populated per the `templates/feature-template-agent-onboard.md` checklist (see Technical Approach for Q1–Q5 answers), and `node -e "require('./lib/agent-registry').getAgent('ag')"` exits 0.
- [ ] `.aigon/docs/agents/antigravity.md` exists, modeled on `.aigon/docs/agents/gemini.md`'s structure.
- [ ] `aigon install-agent ag` completes without error in a scratch test repo and produces the expected output files (settings/policy/command files per whatever `output.format` is determined correct for `agy` — see Open Questions).
- [ ] A new assertion block for `ag` is added to `tests/integration/worktree-state-reconcile.test.js` (replacing the deleted `gg` block), covering its actual launch command shape.
- [ ] `npm run test:core` passes with `gg` fully removed and `ag` fully wired in.
- [ ] `aigon agent-probe ag --all` (or equivalent probe) succeeds against a real Antigravity CLI install — this requires the implementer to actually install `agy` and run `agy auth login` with a real Google account (see Open Questions; this cannot be verified from documentation alone).

## Validation
```bash
node -e "const r=require('./lib/agent-registry'); if (r.getAgent('gg')) { console.error('gg agent still registered'); process.exit(1); } if (!r.getAgent('ag')) { console.error('ag agent not registered'); process.exit(1); } console.log('ok');"
```

## Technical Approach

This is two linked workstreams: **decommission `gg`**, then **onboard `ag`** per `docs/adding-agents.md`. Do the decommission first so the onboarding test/doc edits land on a clean baseline rather than a diff against still-present Gemini content.

### 1. Decommission `gg`

Known reference sites (confirmed via grep on 2026-06-25 — re-grep before starting in case this drifts):
- `templates/agents/gg.json` — delete.
- `.aigon/docs/agents/gemini.md` — delete.
- `AGENTS.md` lines 3, 129, 145, 161, 167, 242, 250 — rewrite each to drop `gg`/Gemini or replace with `ag`/Antigravity as appropriate (e.g. line 3's roster sentence, line 242's per-agent output-file list, line 250's SessionStart hook note).
- `docs/adding-agents.md` lines 9, 22, 43, 58, 67, 81 — same treatment; this file's own table/decision-tree examples cite `gg` as a canonical case, so these need real replacement text, not just deletion.
- `tests/integration/worktree-state-reconcile.test.js` lines ~165 and ~183 — remove the `gg` assertion block (replaced by a new `ag` block in step 2).
- `lib/telemetry.js` — `parseGeminiTranscripts()` and its Gemini model pricing table entries.
- `lib/session-sidecar.js` — `resolveTranscriptPath()`'s `gemini-chats` branch.
- `lib/worktree.js` — `presetGeminiTrust()` and any `cliConfig.command === 'gemini'` branches (`buildRawAgentCommand`, around lines 204/415/417 as of this writing).
- `lib/commands/misc.js` — `capture-gemini-telemetry` hook command (~lines 1225–1261), and the `gg.json` `AfterAgent` hook that invokes it (moot once the JSON is deleted, but check for other callers).
- `lib/feature-close.js` — the `.gemini/settings.json` reset call (~lines 456–459); decide whether `ag`'s settings live under a different path (see Open Questions) and needs an equivalent reset call instead.
- `lib/install-manifest.js`, `lib/template-drift.js` — `.gemini/commands/aigon/` path detection; replace with `ag`'s actual output path once confirmed.

Before deleting `lib/telemetry.js`'s Gemini parser and `lib/session-sidecar.js`'s `gemini-chats` strategy outright: Antigravity's settings still live under `~/.gemini/antigravity-cli/settings.json` (confirmed via Google's own docs) — there is a real chance its session/transcript storage format is a derivative of the old Gemini CLI format rather than something unrelated. **Inspect a real `agy` session directory before deciding whether to adapt the existing parser or write a new one from scratch.** Don't delete blindly.

### 2. Onboard `ag`

Work through `docs/adding-agents.md` Q1–Q5 using what's confirmed from public docs/announcements as of 2026-06-25 (Antigravity CLI launched 2026-05-19; Gemini CLI shutdown 2026-06-18 — this is a ~5-week-old product, expect docs/behavior to still be shifting):

- **Q1 (prompt as CLI arg)**: `agy -p "<prompt>"` exists for headless/CI use — but per the hard-disqualifier rule ("exits after completing a task" is an automatic fail), **verify `-p` doesn't exit immediately** the way Gemini CLI's own `-p` historically did for one-shot prints. If `-p` is exit-on-completion, Aigon needs the equivalent of `gg`'s pattern: launch the bare interactive TUI with an auto-approve flag (candidates seen in docs: `--dangerously-skip-permissions`, `--sandbox`) and confirm the agent stays at its prompt afterward (Q4). This determines the launch type (Slash-command vs TUI-inject) and is the single highest-risk unknown in this spec.
- **Q2 (native `/slash` support)**: Antigravity's TUI has a `/` command menu (`/agents`, `/mcp`, `/diff`, `/rewind`, etc.), but **custom** commands have moved from Gemini CLI's flat `.gemini/commands/aigon/*.toml` files to a **plugin bundle** format (`plugin.json` + optional `mcp_config.json`/`hooks.json` + `skills`/`agents`/`rules` directories, staged at `~/.gemini/antigravity-cli/plugins/<name>/`). Determine whether Aigon's `/aigon:feature-do {featureId}`-style invocation still works as a literal slash command once installed via a plugin, or whether the implement prompt needs to be delivered as plain text invoking a named skill instead. This changes `output.format`, `output.commandDir`, and `cli.implementPrompt`'s shape.
- **Q3 (`--model` flag)**: `agy models` (added v1.0.5) lists available models, suggesting flag-based model selection exists, but confirm the actual flag name/spelling against `agy --help` on a real install.
- **Q4 (stays at own prompt after task)**: depends on the Q1 resolution above.
- **Q5 (transcript telemetry)**: settings live under `~/.gemini/antigravity-cli/settings.json`; find the equivalent session-history directory and file format (JSON? Different shape than Gemini's `~/.gemini/tmp/{slug}/chats/*.json`?) before setting `runtime.sessionStrategy` / `runtime.telemetryStrategy`.

Other config-shape decisions, grounded in what other agents already do (don't invent new mechanisms if an existing one fits):
- **Auth**: Antigravity uses OS-keyring-backed credentials via `agy auth login` (browser flow; SSH/headless prints a URL + one-time code) plus `ANTIGRAVITY_TOKEN` for CI — there is no simple API-key env var like `GEMINI_API_KEY`. This does not fit `authCheck.method: "envVar"` (used by `gg`/`cx`/`km`/`am`). Use `authCheck.method: "command"` instead — the same pattern `cc.json` uses (`"command": "claude auth status"`, `"successIndicator": "loggedIn"`). Find the real `agy` equivalent (likely `agy auth status` or similar) on a live install.
- **Trust**: `gg.json` used `"type": "json-kv"` against `~/.gemini/trustedFolders.json`. Antigravity's plugin/settings model may handle trust differently (or not need a separate trust file at all, given OS-keyring auth) — check `~/.gemini/antigravity-cli/settings.json`'s shape for a trust-equivalent field; `trust.type` options already supported by the registry are `claude-json`, `vscode-settings-bool`, `json-kv`, `toml-project` (per the onboarding checklist) — reuse one if it fits rather than adding a fifth type.
- **Quota error patterns**: real-world reports describe a dual-limit system ("250-unit sprint limit" refreshing every 5 hours, "2,800-unit weekly baseline") and an `"Individual quota reached"` error string, distinct from `gg`'s generic `RESOURCE_EXHAUSTED`/429 patterns. Add a dedicated `quota.errorPatterns` entry matching this language; keep a fallback 429/rate-limit pattern in case the underlying API still surfaces those.
- **`installHint`/`installCommand`**: `agy` installs to `~/.local/bin/` (Unix) or `%LOCALAPPDATA%\Antigravity\` (Windows) per its own installer script, not via `npm i -g` like `gemini-cli` was. Confirm the actual install command/URL Google publishes and use that verbatim — don't guess an npm package name.
- **Hooks**: Antigravity explicitly carries forward "Hooks" as a first-class concept (per Google's own migration messaging), but they're likely declared inside a plugin's `hooks.json` now rather than top-level `settings.json` like `gg.json`'s `extras.settings.hooks`. Confirm the schema before porting `SessionStart`/`AfterAgent` hook definitions (`aigon check-version`, `aigon project-context`, `aigon check-agent-signal`, and whatever telemetry-capture hook replaces `capture-gemini-telemetry`).

### Sequencing note
Steps 1 and 2 should land together (or step 2 immediately after step 1) rather than leaving `gg` deleted with no working Google-model agent in between, since `defaultFleetAgent` and other roster-level assumptions may reference "a Google agent exists" implicitly in Fleet setup flows — grep for `defaultFleetAgent` usage and Fleet roster assumptions before merging step 1 alone.

## Dependencies
- None — this is self-contained to the agent-config/registry layer, per `docs/adding-agents.md`'s own design (config-driven, no hardcoded per-agent branching outside `lib/agent-registry.js`).

## Out of Scope
- Migrating in-flight `feature-*-gg-*` branches or worktrees created before this change lands — those are pre-existing artifacts, not something this feature needs to convert.
- Supporting enterprise Gemini Code Assist Standard/Enterprise users who may still have a working `gemini` CLI per Google's own carve-out — explicitly dropped per maintainer decision (see Summary).
- Building out Antigravity's plugin/MCP/subagent system beyond what's needed to replicate `gg`'s existing feature/research/review/eval prompt delivery. Aigon's own AGENTS.md/skill-pointer content should keep using the existing `templatePath` mechanism, not adopt Antigravity's plugin bundle format internally, unless Q2's investigation shows that's the only way to get custom prompts delivered.
- Backfilling historical Gemini telemetry/cost data into whatever schema `ag`'s telemetry uses — historical `gg` records stay as-is in `.aigon/state`/analytics; no migration script.

## Open Questions
- Does `agy -p "<prompt>"` exit after one response, or stay interactive? This determines the entire launch-type decision (Q1/Q4) and cannot be resolved from documentation — requires a real `agy` install and a real Google account login.
- What is the real custom-command/skill invocation mechanism for Antigravity CLI (plugin-bundled skill vs. literal slash command), and does Aigon's `/aigon:feature-do {featureId}` pattern survive unchanged or need to become a skill name?
- What is Antigravity's session/transcript storage path and file format — is it close enough to Gemini CLI's `~/.gemini/tmp/{slug}/chats/*.json` to adapt `parseGeminiTranscripts()`, or unrelated?
- What is the actual auth-status check command/output for `authCheck.method: "command"` (e.g. does `agy auth status` exist, and what does success output look like)?
- Does `--model <id>` work as a literal flag, and what model IDs does `agy models` actually list (Gemini-family only, or does "optional support for Claude and open-source backends" mean cross-provider model selection inside one agent slot — which would be new territory for Aigon's per-agent `modelOptions` schema)?
- Is there a meaningful trust/folder-approval file at all under Antigravity's keyring-based auth model, or does `trust` become a no-op (`"type": "none"`, matching `cu.json`'s `authCheck.method: "none"` pattern for a different field but a useful precedent for "this concept doesn't apply here")?

## Related
- Background: Google Developers Blog, "An important update: Transitioning Gemini CLI to Antigravity CLI" (announced 2026-05-19, Gemini CLI shutdown 2026-06-18); `google-antigravity/antigravity-cli` GitHub repo; Antigravity CLI docs at `antigravity.google/docs/cli-*`. Researched inline via web search on 2026-06-25 in response to the user's own `gemini auth login` failure ("This client is no longer supported for Gemini Code Assist for individuals").
- Set: <!-- set slug if this feature is part of a set; omit line if standalone -->
- Prior features in set: <!-- feature IDs that precede this one, e.g. F314, F315; omit if standalone -->
