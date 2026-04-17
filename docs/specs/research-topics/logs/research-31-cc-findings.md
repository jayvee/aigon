# Research Findings: Aigon Workflows (Custom Workflow Definitions)

**Agent:** Claude (cc)
**Research ID:** 31
**Date:** 2026-04-17

---

## Key Findings

### 1. Naming: "Workflow" vs Alternatives

**Question:** Does "workflow" conflict with internal `workflow-core` naming?

**Yes — there is a real collision.** The `.aigon/workflows/` directory already exists and contains the event-sourced engine state (`features/`, `research/`, `specs/`). The `lib/workflow-core/` module is the lifecycle state machine. Using "workflow" for user-defined presets creates ambiguity:

- `.aigon/workflows/` = engine state (events, snapshots)
- `.aigon/workflows.json` or `.aigon/workflows/` for templates? Confusing.
- Code references to "workflow" would need disambiguation everywhere

**Alternatives evaluated:**

| Term | Pros | Cons |
|------|------|------|
| **workflow** | Matches user mental model, room to grow | Conflicts with `workflow-core`, `.aigon/workflows/` |
| **playbook** | No internal conflicts, implies a recipe/plan, evocative | Less common in developer tools |
| **preset** | Clear meaning, no conflicts | Feels static/limited, doesn't evoke orchestration |
| **recipe** | Friendly, no conflicts | Too casual for multi-stage pipelines |
| **runbook** | Operations-familiar | Implies incident response, not dev workflow |
| **pipeline** | Familiar from CI/CD | Conflicts with future CI/CD integration |

**Recommendation: `playbook`**. It's unused internally, has no directory/code conflicts, implies a sequence of plays/stages (natural extension to multi-stage), and is familiar from Ansible. CLI surface: `aigon playbook create`, `aigon playbook list`, `--playbook <name>`.

The done-state spec (05-done) already renamed to "Workflows (Custom Aigon Workflows)" but this doesn't resolve the internal naming collision — it actually confirms the spec author noticed the issue and tried to distinguish with "Custom Aigon".

### 2. Current `feature-autonomous-start` Parameters

Full parameter audit from `lib/commands/feature.js:2571-3305`:

| Parameter | Type | Default | Mode | Capturable in Playbook? |
|-----------|------|---------|------|------------------------|
| `agents` | string[] | (required) | Both | **Yes** — primary value |
| `--stop-after` | enum | `close` | Both | **Yes** — primary value |
| `--eval-agent` | agent id | null | Fleet only | **Yes** — mode-dependent |
| `--review-agent` | agent id | null | Solo only | **Yes** — mode-dependent |
| `--poll-seconds` | int | 30 | Internal | No — internal tuning |
| `--session-name` | string | auto | Internal | No — runtime-generated |

**Mode determination is implicit:** `agents.length > 1` = Fleet, `agents.length === 1` = Solo. The playbook schema should store the agent list and let mode derivation happen at runtime (not store mode explicitly).

**Mode-specific constraints (enforced at runtime):**
- Fleet: `--stop-after` cannot be `review`; `--review-agent` ignored
- Solo: `--stop-after` cannot be `eval`; `--eval-agent` ignored
- Solo + `--stop-after=review` requires `--review-agent`

### 3. Minimal Playbook Schema (v1)

```json
{
  "playbooks": {
    "solo-cc": {
      "description": "Implement with Claude Code, auto-close",
      "agents": ["cc"],
      "stopAfter": "close"
    },
    "solo-cc-reviewed": {
      "description": "Implement with CC, review with Gemini, close",
      "agents": ["cc"],
      "stopAfter": "close",
      "reviewAgent": "gg"
    },
    "arena-cc-gg": {
      "description": "Fleet: CC vs GG, CC evaluates",
      "agents": ["cc", "gg"],
      "stopAfter": "close",
      "evalAgent": "cc"
    },
    "arena-all": {
      "description": "Fleet: all agents compete, CC evaluates",
      "agents": ["cc", "gg", "cx"],
      "stopAfter": "close",
      "evalAgent": "cc"
    }
  }
}
```

**Schema definition:**

```typescript
interface Playbook {
  description?: string;       // Human-readable, shown in picker
  agents: string[];           // 1+ agent IDs (determines Solo vs Fleet)
  stopAfter: 'implement' | 'eval' | 'review' | 'close';  // default: 'close'
  evalAgent?: string;         // Fleet only; defaults to agents[0] if omitted
  reviewAgent?: string;       // Solo only; required if stopAfter includes review
}

interface PlaybookConfig {
  playbooks: Record<string, Playbook>;  // key = slug (kebab-case)
  defaultPlaybook?: string;             // Optional default slug
}
```

**Why this is minimal but sufficient:**
- Captures all 4 user-facing autonomous params
- Mode is derived from `agents.length` (not stored)
- Validation rules already exist in `feature-autonomous-start` — playbook just provides input
- `description` enables meaningful display in pickers
- `defaultPlaybook` lets experienced users skip selection entirely

### 4. Storage Location

**Evaluated options:**

| Location | Scope | Version-controlled | Team-shareable | Backup |
|----------|-------|--------------------|----------------|--------|
| `.aigon/config.json` (new `playbooks` key) | Per-project | Yes (committed) | Yes | Git |
| `.aigon/playbooks.json` (dedicated file) | Per-project | Yes (committed) | Yes | Git |
| `~/.aigon/config.json` (new `playbooks` key) | Global | No (user home) | No | Manual |
| `~/.aigon/playbooks.json` (dedicated file) | Global | No (user home) | No | Manual |
| Both: global defaults + per-project overrides | Both | Partial | Partial | Mixed |

**Recommendation: Dedicated `.aigon/playbooks.json` (per-project) with global `~/.aigon/playbooks.json` fallback.**

Rationale:
- **Separate file** avoids bloating `.aigon/config.json` which already mixes tier, instructions, security, devProxy, agents, and worktreeSetup. Playbooks are a distinct concern.
- **Per-project committed to git** means team members inherit the same playbooks. This matches Docker Compose profiles (committed compose.yml) and GitHub Actions (committed YAML).
- **Global fallback** lets users define personal defaults that apply to any project without a project-level file.
- **Merge strategy**: project-level playbooks override global playbooks with the same slug. A user can override `solo-cc` per-project if that project uses a different agent config.
- `.aigon/playbooks.json` is naturally gitignored or committed depending on the team's choice (Aigon already has `.aigon/` partially in `.gitignore`).

**Backup story for global playbooks:**
- Document `~/.aigon/playbooks.json` path so users can add to dotfiles
- Future: `aigon config export/import` could bundle playbooks
- The file is plain JSON — trivially backed up

### 5. Built-in Default Playbooks

**Yes — ship sensible defaults.** Prior art: Docker Compose has no built-ins (users define all profiles), but Buildkite ships template examples. GitHub Actions has starter workflows.

Aigon should ship defaults because:
1. Users need to see the format before they create their own
2. Common patterns are predictable from the agent registry
3. Defaults reduce time-to-value for new users

**Proposed built-in playbooks:**

| Slug | Description | Agents | Stop After | Eval | Review |
|------|-------------|--------|-----------|------|--------|
| `solo-cc` | Solo Claude Code | `["cc"]` | close | - | - |
| `solo-cc-reviewed` | CC implements, GG reviews | `["cc"]` | close | - | `gg` |
| `arena-cc-gg` | CC vs GG, CC evaluates | `["cc", "gg"]` | close | `cc` | - |

**Built-ins are read-only defaults.** They're defined in `templates/playbooks.json` (or equivalent) and merged under user playbooks. If a user creates `solo-cc` in their project, it overrides the built-in. This follows the `profiles.json` pattern already used for project profile presets.

### 6. Runtime Selection

**Three selection paths:**

**a) CLI flag: `--playbook <slug>`**
```bash
aigon feature-autonomous-start 42 --playbook solo-cc-reviewed
```
The playbook's agents/stopAfter/evalAgent/reviewAgent are expanded into the existing parameter slots. Explicit flags override playbook values (e.g., `--playbook solo-cc --stop-after=implement` uses the playbook but overrides stop-after).

**b) Interactive picker** (when no agents or playbook specified):
```
$ aigon feature-autonomous-start 42
? Select a playbook:
  ● Solo CC                      cc → close
  ○ Solo CC + GG Review          cc → review(gg) → close
  ○ Arena CC vs GG               cc,gg → eval(cc) → close
  ○ Custom...                    (enter agents manually)
```
This is the `fzf`-style fuzzy picker pattern. Falls back to manual agent entry if "Custom" selected.

**c) Dashboard dropdown** (in the Start Autonomously modal):
Add a `<select id="autonomous-playbook">` above the existing agent checkboxes. Selecting a playbook pre-fills the checkboxes, eval-agent, review-agent, and stop-after. Selecting "Custom" reveals the manual controls. This is purely UI sugar — the API call still sends the resolved parameters.

**d) Default playbook** (no interaction):
If `defaultPlaybook` is set in config and the user runs `aigon feature-autonomous-start 42` with no other args, use the default. This is the power-user fast path.

### 7. Multi-Stage Pipeline Extension Path

The v1 schema is flat (agents + stopAfter + eval/review). For multi-stage, the schema evolves to:

```json
{
  "playbooks": {
    "full-review-cycle": {
      "description": "Implement → review → counter-review → close",
      "stages": [
        { "name": "implement", "agents": ["cc"] },
        { "name": "review", "agents": ["gg"], "waitFor": "implement" },
        { "name": "counter-review", "agents": ["cc"], "waitFor": "review" },
        { "name": "close", "waitFor": "counter-review" }
      ]
    }
  }
}
```

**The v1 flat schema is forward-compatible with this.** A v1 playbook like:
```json
{ "agents": ["cc"], "stopAfter": "close", "reviewAgent": "gg" }
```
...is semantically equivalent to a 3-stage pipeline: implement(cc) → review(gg) → close. The migration path is:
1. v1: flat params (ships now, works with existing AutoConductor)
2. v2: optional `stages` array (when multi-stage execution exists)
3. Flat-format playbooks continue to work via automatic expansion

**Key insight from CI/CD prior art:** GitHub Actions and Buildkite both started simple and added complexity incrementally. GitHub Actions v1 had only `on`/`jobs`/`steps`; reusable workflows, composite actions, and matrix strategies came later. Aigon should follow the same pattern.

### 8. Dashboard Integration

**Current dashboard modal** (`templates/dashboard/index.html:265-296`) has:
- Agent checkboxes (`#autonomous-agent-checks`)
- Eval agent select (`#autonomous-eval-agent`)
- Review agent select (`#autonomous-review-agent`)
- Stop after select (`#autonomous-stop-after`)

**Integration approach:**
1. Add a playbook dropdown at the top of the modal (above agent checks)
2. Selecting a playbook pre-fills all fields below it
3. Changing any individual field switches dropdown to "Custom"
4. API endpoint `/api/features/{id}/run` accepts optional `playbook` param that resolves server-side

**No new API endpoints needed for v1.** The existing `/api/features/{id}/run` already accepts the resolved parameters. The dashboard resolves playbook → params client-side. Server-side playbook resolution is a v2 nice-to-have.

### 9. Versioning

**Playbooks should NOT be versioned — just overwritten.** Rationale:
- Playbooks are configuration, not code. They don't need rollback.
- The file is committed to git, so version history exists implicitly.
- Adding version tracking increases complexity for zero practical benefit in v1.
- Prior art: Docker Compose profiles have no versioning. npm scripts have no versioning. `.env` files have no versioning.

If a team needs to audit playbook changes, `git log .aigon/playbooks.json` provides full history.

### 10. Simplest v1 That Adds Real Value

**The minimum viable playbook feature is:**
1. `.aigon/playbooks.json` with the flat schema (agents, stopAfter, evalAgent, reviewAgent)
2. `--playbook <slug>` flag on `feature-autonomous-start`
3. 3 built-in defaults (solo-cc, solo-cc-reviewed, arena-cc-gg)
4. `aigon playbook list` to see available playbooks

**What can wait for v2:**
- Interactive picker (when no args given)
- Dashboard dropdown
- Global `~/.aigon/playbooks.json` fallback
- `aigon playbook create` command
- `defaultPlaybook` config
- Multi-stage `stages` array

This v1 is ~100-150 lines of code: read the file, validate the schema, expand into existing params. No changes to the AutoConductor, state machine, or dashboard.

## Sources

- [GitHub Actions Reusable Workflows](https://docs.github.com/en/actions/how-tos/reuse-automations/reuse-workflows) — prior art for named, parameterized workflow definitions
- [Docker Compose Profiles](https://docs.docker.com/compose/how-tos/profiles/) — named configuration presets with runtime selection via CLI flags
- [Buildkite Pipeline Templates](https://buildkite.com/docs/pipelines/governance/templates) — organization-level pipeline template governance
- [OpenAI Codex Workflows](https://developers.openai.com/codex/workflows) — Codex's approach to workflow patterns (usage-pattern documentation, not configurable templates)
- Aigon codebase: `lib/commands/feature.js:2571-3305` — full `feature-autonomous-start` implementation
- Aigon codebase: `lib/dashboard-server.js:1678-1852` — `/api/features/{id}/run` endpoint
- Aigon codebase: `lib/auto-session-state.js` — persisted AutoConductor state schema
- Aigon codebase: `lib/config.js` — existing config layer (project + global)
- Aigon codebase: `templates/dashboard/index.html:265-296` — current autonomous start modal

## Recommendation

**Ship playbooks as a thin input layer over `feature-autonomous-start`.** The key design decisions:

1. **Name: `playbook`** — avoids collision with `workflow-core` and `.aigon/workflows/`
2. **Storage: `.aigon/playbooks.json`** — per-project, committed, team-shareable; global fallback in `~/.aigon/playbooks.json`
3. **Schema: flat v1** — `{ agents, stopAfter, evalAgent?, reviewAgent?, description? }` per slug
4. **Selection: `--playbook <slug>`** — single CLI flag, playbook values expand into existing params
5. **Built-ins: 3 defaults** — solo-cc, solo-cc-reviewed, arena-cc-gg (from `templates/playbooks.json`)
6. **No versioning** — git history suffices
7. **Forward-compatible** — flat schema naturally evolves to `stages[]` when multi-stage execution ships

The v1 is deliberately thin: it's a named parameter bag, not a pipeline engine. This matches the research spec's guidance ("simplest v1 that adds real value without building a full pipeline engine") and the existing pattern where profiles in `.aigon/config.json` are just named configuration — not executable logic.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| `playbook-schema-and-storage` | Define `.aigon/playbooks.json` schema with flat v1 format (agents, stopAfter, evalAgent, reviewAgent) and load/merge logic for project + global files | high | none |
| `playbook-cli-flag` | Add `--playbook <slug>` flag to `feature-autonomous-start` that expands playbook params into existing autonomous parameters | high | playbook-schema-and-storage |
| `playbook-builtin-defaults` | Ship 3 built-in playbooks (solo-cc, solo-cc-reviewed, arena-cc-gg) in `templates/playbooks.json`, merged under user playbooks | high | playbook-schema-and-storage |
| `playbook-list-command` | Add `aigon playbook list` command showing available playbooks with descriptions, agents, and stop-after | medium | playbook-schema-and-storage |
| `playbook-create-command` | Add `aigon playbook create <slug>` interactive command to define new playbooks | medium | playbook-schema-and-storage |
| `playbook-interactive-picker` | When `feature-autonomous-start` is called with no agents or playbook, show a fuzzy picker of available playbooks | medium | playbook-list-command |
| `playbook-dashboard-dropdown` | Add playbook selection dropdown to the dashboard Start Autonomously modal that pre-fills agent/eval/review/stop-after fields | medium | playbook-schema-and-storage |
| `playbook-default-config` | Add `defaultPlaybook` key to `.aigon/config.json` so users can skip selection entirely | low | playbook-cli-flag |
| `playbook-multi-stage-schema` | Extend schema with optional `stages[]` array for multi-stage pipelines (implement → review → counter-review → close) | low | playbook-schema-and-storage |
