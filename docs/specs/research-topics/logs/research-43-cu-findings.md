# Research Findings: session transcript capture and storage

**Agent:** Cursor (cu)
**Research ID:** 43
**Date:** 2026-04-26

---

## Key Findings

### 1. Capture strategy: what exists today (native vs tmux)

- **Native-first binding (F357)** is implemented in `lib/session-sidecar.js`. After `createDetachedTmuxSession` runs, a **detached child process** polls agent-specific on-disk locations until a new file appears (12s timeout, 800ms interval). It then atomically patches `.aigon/sessions/{sessionName}.json` with `agentSessionId` and `agentSessionPath`.
- **Supported agents** for that binding: `cc` (Claude `~/.claude/projects/<escaped-worktree>/*.jsonl`), `gg` (Gemini `~/.gemini/tmp/.../chats/*.json` with optional internal `sessionId`), `cx` (Codex session JSONL from `findCodexSessionFiles`). This reuses `lib/telemetry.js` resolvers; no duplicate parsers in the sidecar module.
- **Not capturable in this path**: `cu`, `op`, and any agent not in `CAPTURABLE_AGENTS` — they never get `agentSessionId` / `agentSessionPath` from aigon. In `templates/agents/`, `transcriptTelemetry` is **true** for cc, gg, cx and **false** for cu, op; `lib/agent-registry.js:supportsTranscriptTelemetry` reflects that for hook/tooling decisions.
- **tmux `pipe-pane` for durable transcripts**: **not present in current `lib/`**. A ripgrep over `lib/` for `pipe-pane` / `peek` returns nothing. Historical Peek used `pipe-pane` to tmpfiles for **HTTP tail** (dashboard), not a long-lived transcript archive; follow-on specs (F355/F356) removed that pipeline in favor of in-dashboard PTY + WebSocket (`lib/pty-session-handler.js`). So the research question “where does pipe-pane attach in the spawn path?” is **moot for today’s code** — the universal tmux floor is not implemented for transcript storage.
- **Implication for “hybrid”**: a future hybrid could be **native primary (structured)** plus **optional pipe-pane or capture-pane to a redacted file** for agents without native logs, but that would be new work and a privacy/size policy decision, not a thin extension of current code.

### 2. Where transcripts “live” across the lifecycle

- **Hot paths today**:
  - **Agent-native stores** (Claude / Gemini / Codex dirs under the user home) — the actual bodies usually **outlive the worktree** because they are not under the feature worktree.
  - **Aigon index**: sidecars at `<repo>/.aigon/sessions/{sessionName}.json` — engine-adjacent but not workflow snapshot state; they reference absolute `agentSessionPath` when F357 succeeded.
  - **Normalized telemetry** (token/cost): `.aigon/telemetry/feature-<id>-<agent>-<sessionId>.json` and aggregation in `lib/telemetry.js:aggregateNormalizedTelemetryRecords` — driven by `capture-session-telemetry` in `lib/commands/misc.js` (e.g. transcript path from CC SessionEnd hook) and close-path usage.
- **Proposed** `~/.aigon/transcripts/<project>/...` **plus cold tier S3** — not implemented. Keeping transcripts **strictly separate** from `.aigon/state/` is already satisfied for native paths (they live outside), but a **dedicated aigon-owned mirror** would be a new write path to design under the **write-path / read-path contract** (and tests).

### 3. Keying scheme

- **Today**: correlation is per **tmux session name** + **entity** fields on the sidecar (`entityType` `f`|`r`|`S`, `entityId` unpadded, `agent`, `role`, `createdAt`) plus F357’s **agent** session id string and **absolute path** to the native file.
- **Entity id vs slug**: sidecars and workflow use **numeric / canonical entity id** after prioritise. Slug renames are handled in the engine; any stable archive key should prefer **entity id** for joins with workflow events (aligns with `migrateEntityWorkflowIdSync` story in AGENTS).
- **One file per invocation vs per “feature run”**: today one sidecar per tmux session; a resume chain could add `resumedFrom` (spec’d in F357 doc) — not required for research brief but matters for “timeline” features.

### 4. Metadata for dashboard / analytics

- **From native JSONL/JSON** (`telemetry.js` parsers): models, token breakdowns, costs — suitable for **efficiency** and spec→outcome studies if you join **entity id + time window + worktree path**.
- **Stuck/looping**: not derived in-repo beyond generic supervisor/idle display (per AGENTS, idle does not auto-fail). Would need heuristics on **tool call repetition** in JSONL or **raw tmux** — explicitly **out of scope** for “ML” in the research spec but **simple heuristics** are plausible on native logs first.
- **Tmux stream**: would give **everything printed** (including secrets) and ANSI noise; higher redaction burden.

### 5. `pipe-pane` wiring (as asked in the brief)

- **Current spawn path** (`lib/worktree.js:createDetachedTmuxSession`): `tmux new-session -d -s ... -c cwd`, optional `bash -lc` command, `writeSessionSidecarRecord`, then `spawnCaptureProcess` for F357 — **no** `pipe-pane`.
- **Rotation/size**: N/A for pipe-pane; F357’s window is time-bounded polling, not unbounded log growth from tmux.
- If product wants a **universal floor** again, the natural hook is still **immediately after** successful `new-session` (same as today’s sidecar write), with explicit **stop** on session kill and **retention** policy — and likely **opt-in** given secrets.

### 6. Privacy / read-only dashboard rule

- **No** first-class redaction or opt-in object-store upload in the code paths reviewed; research items are product/policy.
- **Dashboard** must not read raw files from the client; any “timeline” or “open transcript” should go through **server-owned** collectors (same principle as `dashboard-status-collector` / no direct engine parse in frontend). F357 already positions `agentSessionPath` as prerequisite for a future “Open transcript” that opens a file path or secure proxy URL.

### 7. What to ship first (opinion)

- **Near-term value / low new surface**: extend **F357** with **user-facing** “open / path” and **read-model fields** (server-side) for linked transcript — builds on existing sidecar + telemetry, avoids new storage tier.
- **Next**: **opt-in copy** to `~/.aigon/transcripts/...` or encrypted blob with **redaction** pass — before any cloud.
- **Later**: S3/GCS, stuck-detection UI, quarantine evidence — once local retention and permissions are trusted.

### 8. Cost model (qualitative; no production measurements in repo)

- Claude JSONL can be **large** for long sessions; Gemini JSON and Codex JSONL similar. **P99** dominated by all-tool-output sessions — argues for **tiering**, **lite mode** (metadata-only from telemetry + pointers), and **retention** defaults.

## Sources

- `lib/session-sidecar.js` — F357 capture loop, `CAPTURABLE_AGENTS`, `updateSessionSidecar`, `readLatestSidecarWithSession`, `resolveResumeArgs`
- `lib/worktree.js` — `writeSessionSidecarRecord`, `createDetachedTmuxSession` (spawn + F357 `spawnCaptureProcess`)
- `lib/telemetry.js` — `resolveClaudeProjectDir`, `findTranscriptFiles`, `findCodexSessionFiles`, `resolveGeminiChatsDir`, parsers, `aggregateNormalizedTelemetryRecords`
- `lib/agent-registry.js` — `supportsTranscriptTelemetry`
- `templates/agents/{cc,gg,cx,cu,op}.json` — `transcriptTelemetry` flags
- `lib/commands/misc.js` — `capture-session-telemetry` CLI / stdin JSON
- `docs/architecture.md` (agent transcript binding + F357)
- `docs/specs/features/05-done/feature-357-record-agent-session-ids.md` — intended resume + future “view transcript”
- Prior research: `docs/specs/research-topics/logs/research-40-cc-findings.md` (Peek / pipe-pane history, since removed from `lib/`)

## Recommendation

- Treat **native structured logs (cc, gg, cx) as the primary source of truth** for anything analytics-grade; use **keying** anchored on **entity id + agent + agent session id + worktree path**, already partially realized via F357 and telemetry.
- Reintroduce **tmux-based capture** only as an **opt-in, redacted, size-capped** complement for agents (cu/op) that lack a stable native file, **not** as a silent default — and implement at **`createDetachedTmuxSession` success** if ever added (with teardown on session end).
- Add a **dedicated non-state directory** (e.g. `~/.aigon/transcripts/<project>/...` or per-repo under `.aigon` with a clear name) for **mirrors and metadata sidecars** (`.meta.json`) in a **later** feature, with **off-by-default cloud sync**.
- For **first shippable user value**, prioritize **exposing and linking** existing `agentSessionPath` through the **dashboard API** (read-model) and a small **CLI** helper — before building S3 or heavy analytics.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| transcript-read-model-api | Server endpoint(s) that expose per-entity, per-agent transcript pointers and optional metadata (from sidecar + telemetry) for dashboard/CLI; no direct browser file read | high | none (F357 data already present for cc/gg/cx) |
| transcript-cli-path | `aigon feature-transcript` / `research-transcript` prints or opens `agentSessionPath` when resolvable | high | transcript-read-model-api (shared resolver) |
| aigon-transcript-mirror | Opt-in: copy or hardlink agent-native transcript to `~/.aigon/transcripts/<repo>/...` on session end or on schedule, with `.meta.json` (entity id, model, times, source path) | medium | transcript-read-model-api |
| tmux-raw-capture-opt-in | Optional `pipe-pane` (or `capture-pane` periodic) to bounded, redacted file for agents without native session files; off by default | low | aigon-transcript-mirror or standalone privacy spec |
| transcript-cold-tier-upload | Async upload to S3/GCS/R2 with pre-upload redaction and org policy; delete-after-upload local option | low | aigon-transcript-mirror, privacy + config design |
