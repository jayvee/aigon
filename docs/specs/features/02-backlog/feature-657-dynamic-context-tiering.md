---
complexity: high
depends_on: []
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T01:09:29.618Z", actor: "cli/feature-prioritise" }
---

# Feature: dynamic-context-tiering

## Summary

Reduce per-session token cost for Aigon-managed agent sessions by **assembling and delivering tiered project context at launch time** instead of letting harnesses (especially OpenCode) inject the full `AGENTS.md` (~68 KB / ~15–18k tokens) on every turn-1 API call. Extend the existing `aigon project-context` primitive into a **task- and agent-aware context bundle** (`hot`, `implement`, `reference`, optional `full`), wire it through each agent's established injection path, and push depth to **on-demand file reads** via pointers. v1 targets measurable OpenRouter input-token reduction on `op` feature-do spawns; cc/cu/cx benefit from tighter defaults but are not the primary cost driver.

## Background for reviewers

### Incident that motivated this work (2026-07-08/09)

Operator observed OpenRouter **Credits** charges from app `OpenCode` with a suspicious pattern:

| Signal | Meaning |
|--------|---------|
| ~32–36k **input** tokens, 2–8 **output** tokens | Not real feature work — health probes or session bootstrap |
| Many models at the **same timestamp** | OpenRouter multi-provider fan-out per logical request |
| Gemini 3.5 Flash rows at **$0 BYOK** | OpenCode hidden `title` agent (not Aigon's probe target list) |
| DeepSeek / Qwen / Grok rows at **paid Credits** | `opencode run` probes + full `build` agent sessions |

Root causes identified:

1. **`opencode run` is a harness, not a thin API call.** It boots the `build` agent in the project cwd and injects system prompt + tool schemas + project rules — even for a one-word "PONG" probe.
2. **Aigon's quota poller** invoked `opencode run` from the repo root, so every probe paid for full project context. Dashboard ↻ refresh with `allModels: true` multiplied by ~11 non-quarantined OpenRouter models.
3. **OpenCode `title` agent** fires Gemini on every session start (`agent=title`, `small=true` in `~/.local/share/opencode/log/opencode.log`).
4. **`AGENTS.md` in this repo is maintainer reference**, not session-start material: 415 lines, ~68 KB. OpenCode appears to treat it (and `.agents/skills/aigon-*`, rules) as ambient context.

### Mitigations already shipped on `main` (commit `95e233cbe`, not a dependency — context for reviewers)

These are **probe-cost fixes**, not context-tiering. Reviewers should not re-litigate them; this feature builds on top.

| Change | File(s) | Effect |
|--------|---------|--------|
| `skipQuotaProbe: true` on `op` | `templates/agents/op.json` | Automatic quota poller skips paid `opencode run`; OpenRouter wallet via free HTTP API |
| `probeAllModelsOnRefresh: false` default | `lib/config-core.js`, `lib/agent-quota-poller.js` | Dashboard ↻ probes default model only unless opted in |
| `--dir $TMPDIR` + disable `title` agent during probes | `scripts/probe-agent.js` | Manual probes avoid project context + Gemini side-call |
| Exclude `openrouter/{google,anthropic,openai}/*` from op probe list | `scripts/probe-agent.js` | Vendors already covered by `ag` / `cc` / `cx` |

**Remaining gap:** real `feature-do` / `feature-start` OpenCode sessions still load ~30k tokens on turn 1. That is what this feature addresses.

### Current context delivery by agent (uneven tiering)

| Agent | Session-start injection | Full `AGENTS.md` in prefix? |
|-------|-------------------------|----------------------------|
| **cc** | `SessionStart` → `aigon project-context` | **No** — ~8-line pointer from `templates/generic/agents-md.md` |
| **cu** | `.cursor/rules/aigon.mdc` (hot rules + pointers) | Rule *references* `AGENTS.md`; Cursor may load rule only |
| **cx** | Inline `feature-do.md` body via `agent-prompt-resolver` | Task prompt, not orientation doc |
| **op** | OpenCode `build` agent from project cwd | **Yes, automatically** — primary cost driver |

Existing pointer template (`templates/generic/agents-md.md`):

```markdown
<!-- AIGON_START -->
## Aigon
This project uses the Aigon development workflow.
- Agent-specific notes: `.aigon/docs/agents/*.md`
- Development workflow: `.aigon/docs/development_workflow.md`
<!-- AIGON_END -->
```

`lib/commands/setup/project-context.js` extracts the marker block and prints it (or `--json` for hooks). **The infrastructure for slim context already exists; it is not wired for OpenCode or task-aware expansion.**

### Relevant launch / env surfaces (implementation anchors)

| Surface | Module | Notes |
|---------|--------|-------|
| `aigon project-context` | `lib/commands/setup/project-context.js` | Extend with `--tier`, `--agent`, `--task` |
| cc/cu hooks | `templates/agents/cc.json`, `cu.json` | SessionStart already calls `project-context` |
| op spawn | `lib/agent-launch-command.js` | Sets `AIGON_ENTITY_TYPE`, `AIGON_ENTITY_ID`, `AIGON_AGENT_ID`, `AIGON_TASK_TYPE`, `AIGON_PROJECT_PATH` |
| op inline prompt | `lib/agent-prompt-resolver.js` | Non-slash agents get full `feature-do.md` body |
| OpenCode runtime override | `OPENCODE_CONFIG_CONTENT` env | Already used in `scripts/probe-agent.js` for probe-only `title.disable` |
| Marker pattern | `AIGON_START` / `AIGON_END`, migrations | Reuse for `<!-- AIGON_CONTEXT tier=hot -->` blocks |

### Token budget intuition (aigon repo, turn 1)

| Approach | Estimated input prefix |
|----------|------------------------|
| Today — op full cwd | ~30k |
| Static slim `AGENTS.md` (editorial split only) | ~3–5k |
| `project-context --tier hot` only | ~0.5–1k |
| Hot + task slice (`implement`) | ~2–4k |
| Agent reads `docs/architecture.md` on demand | +0 upfront; +3–8k when needed |

### Target-repo boundary (load-bearing)

Anything under `templates/{generic,docs,specs,prompts}/` installs into **user repos** Aigon knows nothing about. Tiering must:

- Work when the user has **no** marker-tagged `AGENTS.md` (fallback = current 8-line pointer).
- **Not** assume `docs/architecture.md`, `lib/`, or npm test commands exist in target repos.
- Keep generated paths under `.aigon/` (aigon-owned) where possible.

This repo (`aigon`) may additionally restructure its own `AGENTS.md` with markers as a **reference implementation** — that is maintainer docs, not a template leak.

## User Stories

- As an operator paying OpenRouter per token, I want OpenCode feature sessions to start with **hot rules + pointers** (~1–4k tokens), not the full maintainer orientation doc, so routine implementation does not burn credits on context I already pay for via cc/cx subscriptions.
- As an operator, I want **task-appropriate context** (implement vs review vs close) assembled automatically from `AIGON_TASK_TYPE` so review sessions do not load iterate-gate prose and implement sessions do not load close-checklist prose.
- As a maintainer, I want **one source of truth** (marker-tagged sections or tier config) so slim session context and full reference docs do not drift.
- As a user in a **generic target repo** with only aigon installed, I want tiering to degrade gracefully to the existing 8-line `project-context` pointer when no markers or tier config exist.
- As a reviewer, I want a **measurable before/after** (OpenRouter input tokens or OpenCode log `tokens.input` on turn 1) documented in the implementation log so we know the feature worked.

## Acceptance Criteria

### Context assembly (`project-context` v2)
- [ ] `aigon project-context` accepts `--tier <hot|implement|review|close|full>` (default `hot`) and optional `--agent <id>` / `--task <taskType>`; unknown tier → exit non-zero with actionable message.
- [ ] **Marker extraction:** when `AGENTS.md` (repo root) contains `<!-- AIGON_CONTEXT tier=<name> -->` … `<!-- AIGON_CONTEXT end -->` blocks, `--tier` concatenates matching blocks in file order. When absent, `hot` tier falls back to existing `templates/generic/agents-md.md` marker content (backward compatible).
- [ ] **Tier config:** `.aigon/config.json` may define `context.tiers.<name>` as an ordered list of paths/globs **relative to repo root** (e.g. `.aigon/docs/development_workflow.md`, `AGENTS.md#hot`); paths under `.aigon/docs/` only for v1 — no template self-references. Config tiers merge with marker extraction; config wins on path conflicts.
- [ ] `aigon project-context --json` continues to work for cc/cu/ag hooks (hook output shape unchanged for default `hot` tier).
- [ ] **Task mapping:** when `AIGON_TASK_TYPE` is set in env (launch already exports it), default tier resolves as: `implement`→`implement`, `review`/`spec-review`/`code-review`→`review`, `close`→`close`, else `hot`. Explicit `--tier` flag overrides.

### OpenCode delivery (v1 primary)
- [ ] On `op` entity spawn (`buildAgentCommand` / `launchPromptCommand` path for `op`), write `.aigon/generated/context-op-<tier>.txt` (gitignored via `aigon doctor` / install manifest pattern) containing `project-context --tier <resolved> --agent op` output.
- [ ] Inject OpenCode `build` agent system prompt via `OPENCODE_CONFIG_CONTENT` pointing at that file (`prompt: "{file:.aigon/generated/context-op-<tier>.txt}"` or equivalent supported OpenCode config shape) **and** `agent.title.disable: true` for spawned sessions.
- [ ] Generated file is refreshed when tier/task changes (new spawn); stale file from prior entity is overwritten.
- [ ] **Regression guard:** integration test asserts `buildCmd`/spawn env for `op` feature-do includes `OPENCODE_CONFIG_CONTENT` with `title.disable` and does not rely on cwd alone for orientation.

### cc / cu hook alignment (v1 secondary)
- [ ] cc `SessionStart` hook updated to `aigon project-context --tier hot` (explicit; behaviour unchanged unless markers added).
- [ ] cu hook parity if cu `project-context` invocation exists in template — same explicit `--tier hot`.

### aigon repo reference implementation (maintainer-only)
- [ ] This repo's `AGENTS.md` gains `AIGON_CONTEXT` marker blocks separating **hot** (≤~80 lines: quick facts, hot rules, reading order pointers) from **reference** (module map, state architecture, incident lists). `hot` block must not reference `lib/<module>.js` paths that would leak in user templates — pointers use user-repo-safe paths (`.aigon/docs/`, `docs/specs/`, `aigon feature-spec`).
- [ ] `docs/architecture.md` remains the deep reference; hot tier points to it, does not inline it.

### Measurement & docs
- [ ] Implementation log records **before/after turn-1 input tokens** for one `op` `feature-do` spawn on this repo (OpenCode log or OpenRouter row); target: **≥50% reduction** vs baseline captured in log (baseline may be quoted from pre-feature OpenRouter logs ~32k).
- [ ] `site/content/guides/agent-quota-awareness.mdx` or new `site/content/guides/agent-context.mdx` documents tiers, marker opt-in, and op-specific behaviour (target-repo-safe wording).
- [ ] `AGENTS.md` § Install Architecture or new short § Context tiers documents the contract for maintainers.

### Tests
- [ ] Unit/integration: marker extraction (fixture `AGENTS.md` with two tiers → `--tier hot` output excludes reference block).
- [ ] Unit/integration: fallback when no markers (output matches legacy `agents-md.md` pointer).
- [ ] Unit/integration: task-type env → tier resolution table.
- [ ] REGRESSION: `project-context --json` hook output still valid JSON with `additionalContext` key.

## Validation

```bash
node -c lib/commands/setup/project-context.js
npm run test:iterate
```

Post-implementation manual check (document in log, not automated gate):

```bash
# Baseline vs after: compare OpenCode log tokens.input on first stream line for op feature-do
aigon feature-do <ID>   # op agent, one spawn
```

## Pre-authorised

- iterate-gate-static-guards-preexisting when marker refactor touches `AGENTS.md` structure only and scoped tests pass

## Technical Approach

### Design principle

**Assemble minimum correct context for `{agent, task, repo}` at launch; deliver through each agent's injection path; push depth to on-demand reads.**

Do not symlink or rewrite root `AGENTS.md` at runtime. Do not require RAG.

### Architecture

```
templates/generic/context/hot.md          ─┐
AGENTS.md  (AIGON_CONTEXT markers)        ─┼─► project-context.js ──► stdout / file / JSON
.aigon/config.json  context.tiers         ─┘         │
profile + AIGON_TASK_TYPE + --agent                   │
                                                      ├─► cc/cu SessionStart hook
                                                      ├─► .aigon/generated/context-op-*.txt
                                                      │         └─► OPENCODE_CONFIG_CONTENT
                                                      └─► (future) cx prompt prefix
```

### Tier contents (recommended v1)

| Tier | Intended use | Typical contents |
|------|--------------|------------------|
| `hot` | Every session | Workflow pointer, 10–15 non-negotiable rules, `aigon feature-spec` / dev-server / state-transition rules |
| `implement` | `feature-do`, `research-do` | `hot` + iterate/validation pointers from `.aigon/docs/development_workflow.md` (section extract or marker) |
| `review` | code/spec review | `hot` + escalation marker syntax, review-complete flags |
| `close` | `feature-close` | `hot` + close checklist pointers |
| `full` | Maintainer/debug | All markers / full tier list (CLI only; never default spawn) |

### OpenCode-specific notes

OpenCode docs (`opencode.ai/docs/config`) support:

- `agent.<id>.prompt` / `{file:...}` indirection
- `agent.title.disable: true`
- `OPENCODE_CONFIG_CONTENT` runtime override (precedence below managed config)

Probe path already uses this env var in `scripts/probe-agent.js` — **reuse the same helper** in `agent-launch-command.js` for production spawns (extract shared `buildOpencodeLaunchEnv({ tier, repoPath })` to avoid drift).

### cc/cx/op parity note

cx already receives full `feature-do.md` inline (~100 lines) — lower priority than op. Do not duplicate hot rules into inline prompt if `project-context` is also injected; avoid **double hot tier** on cx in v1.

### Gitignore / install

- Add `.aigon/generated/` to install-time gitignore template if not already present.
- Generated context files are ephemeral — never committed.

## Dependencies

- None (probe-cost mitigations on `main` are complementary, not blocking).
- **Soft:** OpenCode config schema stability (`OPENCODE_CONFIG_CONTENT`, `{file:...}` prompt) — if OpenCode changes shape, guard with version check or feature flag `context.opencodeInject: false`.

## Out of Scope

- Replacing `AGENTS.md` with a database or RAG index.
- Automatic git-diff → module-map slice selection (v2; mention in Open Questions).
- Forcing all target repos to restructure `AGENTS.md` (opt-in markers only).
- Reducing context for **cc/cx subscription agents** beyond explicit `--tier hot` on hooks (no measurable per-token cost for operator).
- OpenCode upstream changes to default context loading behaviour (file issue / track separately).
- Slimming the inline `feature-do.md` template body (separate concern; task prompt ≠ orientation).
- Pro-only context profiles / cross-machine sync.

## Open Questions

1. **OpenCode `{file:...}` path resolution** — relative to repo root or opencode config dir? Implementer must verify against installed `opencode` version and document in log.
2. **cu alwaysApply rule** still says "read AGENTS.md" — update `templates/generic/cursor-rule.mdc` to "run `aigon project-context`" or point to `.aigon/docs/` only? (Template change → `aigon install-agent cu`.)
3. **Should `implement` tier inline a feature spec summary** when `AIGON_ENTITY_ID` is set, or rely on existing `aigon feature-do` CLI inline spec? Prefer **CLI spec remains authoritative**; tier only adds process rules.
4. **Marker delimiter nesting** — forbid nested `AIGON_CONTEXT` in v1; parser treats as flat.

## Related

- Prior work: probe-cost commit `95e233cbe` (`skipQuotaProbe`, `probeAllModelsOnRefresh`, probe `--dir`, title disable, vendor exclusion)
- Prior work: F444 / F616 agent-quota (probe vs HTTP wallet); F420 install boundary (`AGENTS.md` user-owned)
- Existing primitive: `lib/commands/setup/project-context.js`, `templates/generic/agents-md.md`
- OpenCode config: https://opencode.ai/docs/config/ (agents, `small_model`, `disabled_providers`, `OPENCODE_CONFIG_CONTENT`)
- Operator evidence: OpenRouter logs 2026-07-08 — OpenCode app, ~32k input / 2–8 output, multi-provider fan-out
- OpenCode log pattern: `agent=title modelID=google/gemini-3.5-flash small=true` alongside `agent=build mode=primary`
