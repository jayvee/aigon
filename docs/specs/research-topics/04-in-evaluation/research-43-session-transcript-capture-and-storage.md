---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-25T13:26:43.164Z", actor: "cli/research-prioritise" }
---

# Research: session-transcript-capture-and-storage

## Context

Aigon orchestrates multiple agents (cc, gg, cx, cu) across worktrees via tmux/iTerm. Today, the only durable artifacts of an agent run are the diff and the run-log entry — the *reasoning path* that produced them is invisible. That blind spot blocks several things Aigon already wants to do well: comparing agents on more than diff quality, calibrating spec→outcome quality (does `afsr` review actually shorten runs?), detecting stuck/looping agents, and producing audit evidence when a model misbehaves (cf. quarantine workflow, F358).

Two capture surfaces exist already: native agent transcripts (Claude Code writes structured JSONL to `~/.claude/projects/`; Codex/Cursor/Gemini each have their own format or none) and the tmux session itself (uniform but raw ANSI, can be tapped via `pipe-pane`). The question is whether Aigon should systematically capture, key, and store these — and what user-facing features justify the storage and privacy cost.

Storage location must be separate from engine state (`.aigon/state/`) and must outlive the worktree, since worktrees are deleted on feature-close. Long-term retention likely belongs in object storage (S3/GCS/R2) on an opt-in basis, since transcripts contain secrets and verbatim file contents.

## Questions to Answer

- [ ] What's the right capture strategy: native-only, tmux-only, or hybrid (native primary + tmux as universal floor)? Which agents have usable native logs today, which don't, and what's the format heterogeneity cost?
- [ ] Where should transcripts live across the lifecycle? Hot tier (local, e.g. `~/.aigon/transcripts/<project>/...` outside the worktree so they survive feature-close), cold tier (S3/GCS/R2 with async upload), and how do we keep them strictly separate from `.aigon/state/`?
- [ ] What's the keying scheme? Proposed: `<project>/<entity-type>/<entity-id>/<agent>/<session-uuid>.jsonl` plus a `.meta.json` sibling for queryable fields (model, ts, tokens, exit, commits, source). Should keys use entity-id (survives slug renames via `migrateEntityWorkflowIdSync`) or slug? One file per agent invocation or per feature run?
- [ ] What metadata schema does the dashboard need to answer the headline questions (per-agent failure modes by problem class, spec-quality→outcome correlation, stuck-detection)? What can be derived from native logs vs. what needs to be inferred from the tmux stream?
- [ ] How is `tmux pipe-pane` wired in? Where in the spawn path does the hook attach so capture starts at session creation (not retroactively)? What's the format (raw ANSI vs. sanitised) and how is rotation/size handled for long sessions?
- [ ] What's the privacy/secrets posture? Opt-in defaults, redaction for known patterns (env files, `.env.local`, API keys), what's never uploaded, how users delete a transcript after the fact, and how this interacts with the existing read-only dashboard rule.
- [ ] What user-facing features unlock once transcripts exist, and which one justifies shipping first? Candidates: timeline view from the feature card, side-by-side agent reasoning compare, stuck-detection flags on the dashboard, spec-quality dashboard, replay for debugging shipped-broken features, quarantine evidence trail.
- [ ] Cost model: storage size per session (typical and p99), upload bandwidth, lifecycle policy (e.g. auto-archive after feature close + N days, delete after M months), and whether there's a meaningful "lite" capture mode (metadata-only, no body).

## Scope

### In Scope
- Capture mechanisms: native transcripts per agent, `tmux pipe-pane`, hybrid layering.
- Storage layout, keying, metadata schema, retention.
- Privacy/redaction posture and opt-in flow.
- Headline user-facing features and which ranks first.
- Integration points with existing surfaces: dashboard, eval, quarantine, run logs.

### Out of Scope
- Implementation. This is a brief; building a feature comes after `are` synthesis.
- Cross-machine sync / multi-user collaboration on transcripts.
- ML-driven analysis of transcripts (loop detection beyond simple repeated-tool-call heuristics).
- Replacing or restructuring `.aigon/state/` — transcripts are additive.

## Findings

Both **cc** and **cu** investigated the same code surface independently and converged on most of the architecture. Synthesis below.

### What's already shipped (F357)
`lib/session-sidecar.js` already polls each native log directory after `createDetachedTmuxSession` and writes `agentSessionId` + `agentSessionPath` onto `.aigon/sessions/{name}.json`. `CAPTURABLE_AGENTS = {cc, gg, cx}` — these have native JSONL/JSON; `cu`, `op`, `km` do not. `lib/telemetry.js` already produces normalized per-session token/cost summaries at `.aigon/telemetry/...`. **The pointer layer is solved.** What's missing is durability and a story for the non-native agents.

### Format heterogeneity (agreed)
| Agent | Native log | Wired today |
|-------|-----------|-------------|
| cc | `~/.claude/projects/<slug>/<uuid>.jsonl` | yes |
| cx | `~/.codex/sessions/**/*.jsonl` | yes |
| gg | `~/.gemini/tmp/.../chats/*.json` | yes |
| cu | none discovered | no — excluded from CAPTURABLE_AGENTS |
| op | router; depends on backing model | no |
| km | unknown | no |

### Storage layout (agreed)
- **Machine-global** `~/.aigon/transcripts/<repo>/<entityType>/<entityId>/<agent>/<role>-<sessionUuid>.{jsonl,meta.json,tmux.log}` — outside any worktree, survives `feature-close` / `feature-reset` / `git clean`, not under `.aigon/state/`.
- **Keying**: numeric `entityId` after prioritise (slug pre-prioritise); extend `migrateEntityWorkflowIdSync` to atomically rename slug → numeric directory at the same moment workflow keys re-key.
- **One file per tmux session** (not per feature run). `role` from `parseTmuxSessionName` (`do | auto | review | eval | close`); `sessionUuid` = `agentSessionId` if available else `sha1(sessionName)[0:12]`.

### Metadata schema (agreed)
`.meta.json` is a strict superset of the existing telemetry record — no parser duplication. Holds `telemetryRef`, `sessionName`, `tmuxId`, `agentSessionId`, byte counts, finalisation marker. Dashboard answers headline questions by joining telemetry rows + meta sidecars; bodies opened only on user click via a server-owned reader (preserves dashboard read-only rule).

### Privacy / opt-in (agreed)
- Hot tier (local copy of native body) ON by default — already pointed at by the sidecar; same privacy boundary
- Cold tier (S3/R2/GCS) OFF until `aigon transcripts upload-config` runs
- Redaction at **export time**, not capture time — local hot copy is verbatim (matches Claude's behaviour)
- `aigon transcripts delete <key>` removes body, tmux log, meta, and any cold-tier copy
- Dashboard reads via new collector; never writes/redacts/deletes (those are CLI commands)

### The one disagreement: tmux pipe-pane default
**cc** argues for wiring `pipe-pane` into `createDetachedTmuxSession` as a universal floor with opt-out — gives cu/op/km a transcript and unlocks byte-growth-based stuck detection for free. p99 size ~500MB (5-10× native).

**cu** argues `pipe-pane` should be opt-in only, scoped to non-native agents, and bounded/redacted — ANSI noise + secrets-in-pane risk + size cost don't justify universal default.

The conservative read wins: native-first (cc/gg/cx) covers >80% of sessions; `pipe-pane` ships as opt-in for the non-native floor. Stuck-detection upgrade can come later if/when usage proves it valuable.

### First-ship value (synthesised)
**cu**'s ranking — expose what we already have via read-model API + CLI before building new storage — is the right first move because it ships value with zero new write paths. **cc**'s F-C (durable hot tier copied at `feature-close`) is the second move because it's the smallest thing that gives us "transcript still exists 90 days later." Quarantine evidence and cold tier are downstream.

### Cost model
Typical Claude JSONL: 200KB–2MB; p99 ~50MB. tmux pipe-pane: 5-10× larger, p99 ~500MB. Realistic load: 10 features × 4 agents × ~2MB native + 10MB tmux ≈ 480MB/wk hot. R2 cold: ~$0.40/yr per machine. Negligible storage cost; the real cost is privacy surface + redaction work.

## Recommendation

**Do not build a parallel capture pipeline.** Extend the existing F357 sidecar layer in three small features. Defer cold tier and dashboard analytics until usage data justifies them.

1. **Read-model + CLI for what already exists** — expose `agentSessionPath` through dashboard API and `aigon feature-transcript` / `research-transcript` so existing pointers become user-visible. Zero new write paths.
2. **Durable hot tier** — at `feature-close` and `agent quarantine`, copy `agentSessionPath` body into `~/.aigon/transcripts/...` and write the `.meta.json` sibling joining telemetry. Extend `migrateEntityWorkflowIdSync` for atomic slug→numeric directory rename. Survives worktree deletion and native log rotation.
3. **Opt-in tmux floor for non-native agents** — `pipe-pane` for cu/op/km only, gated behind `~/.aigon/config.json:transcripts.tmux=true`. Bounded size, redaction-at-export.

Cold tier (S3/R2/GCS), stuck-detection signal, side-by-side reasoning compare, and spec→outcome dashboards all wait until at least 90 days of hot-tier data exists.

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
