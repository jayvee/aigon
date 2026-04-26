# Research Findings: session transcript capture and storage

**Agent:** Claude (cc)
**Research ID:** 43
**Date:** 2026-04-26

---

## Key Findings

### 1. We are 70% of the way to "transcript capture" already — the gap is durability, not capture

`lib/session-sidecar.js` already does the post-launch dance for cc/gg/cx: it polls each agent's native session-storage directory, finds the newest file whose mtime crosses the spawn threshold, and writes `agentSessionId` + `agentSessionPath` onto the sidecar at `.aigon/sessions/{sessionName}.json`. F357 shipped this and `feature-do --resume` already uses it via `resolveResumeArgs` (`cc → --resume <uuid>`, `cx → resume <id>`, `gg → --resume <id>`).

What we have today is a **pointer** to the live native log. What we don't have is a **durable copy** that survives:
- Native-side compaction / rotation (Claude prunes its own JSONL files; we have no SLA on retention)
- `rm -rf ~/.claude/projects/<dir>` user cleanup
- The user moving / renaming their home directory
- The worktree being deleted on `feature-close` (the worktree path is what `resolveClaudeProjectDir` slug-reconstructs against — once the worktree is gone, "find the transcript later" gets fuzzier)

**Capture is solved. Persistence is not.**

### 2. Format heterogeneity: cu is the outlier; everyone else is JSONL-ish

| Agent | Native log location | Format | Already wired? |
|-------|---------------------|--------|----------------|
| cc    | `~/.claude/projects/<slug>/<uuid>.jsonl` | JSONL, structured turns | yes — `resolveClaudeProjectDir` |
| cx    | `~/.codex/sessions/**/*.jsonl` | JSONL, cwd in `session_meta` | yes — `findCodexSessionFiles` |
| gg    | `~/.gemini/tmp/<chats>/*.json` | single JSON blob with `sessionId` | yes — `resolveGeminiChatsDir` |
| cu    | (none discovered) | — | **no — excluded from `CAPTURABLE_AGENTS`** |
| op    | (router; depends on backing model) | — | no |
| km    | unknown | — | no |

The `CAPTURABLE_AGENTS = new Set(['cc', 'gg', 'cx'])` line in `lib/session-sidecar.js:21` is the entire heterogeneity surface today. For **cu, op, km**, native capture is impossible — for these the only available transcript is **tmux pipe-pane**.

### 3. tmux pipe-pane is the right "universal floor"

`createDetachedTmuxSession` in `lib/worktree.js:1211` is the single chokepoint where every agent session is born. Right after `runTmux(['new-session', ...])` succeeds and we have `tmuxId`, attaching `pipe-pane -t $TMUXID -O 'cat >> <path>'` captures the *raw ANSI byte stream* for every agent uniformly — regardless of whether the agent has a native transcript. Cost: one extra tmux command per spawn; output is append-only, no daemon needed.

Trade-offs vs. native:
- **Pro**: works for cu/op/km; survives whatever the agent does to its own logs; one parser for all agents
- **Con**: raw ANSI (carriage returns, escape codes, cursor moves); turn boundaries must be inferred; sanitising for display ≠ trivial; large for long sessions

So **hybrid** is the right answer:
- **Native (when available)** = source of truth for *structured replay & metrics*
- **tmux pipe-pane (always)** = source of truth for *raw "what did the user actually see"* and the only floor for non-native agents

### 4. Storage layout — the one rule that matters

> Transcripts must outlive the worktree.

The existing sidecar lives at `<mainRepoPath>/.aigon/sessions/<sessionName>.json` — that survives feature-close because `feature-reset` only deletes worktree state, not main-repo `.aigon/sessions/`. But the native log it points at is in the *worktree-derived* `~/.claude/projects/-<slugged-worktree-path>/`. Once the worktree directory is gone, slug reconstruction still works (it's just string munging on the path), but the native log itself may be GC'd by Claude any time.

Proposed two-tier layout:

```
~/.aigon/transcripts/                                 ← machine-global (NOT inside any repo)
  <repo>/                                              ← repo basename (or full hash if collision)
    <entityType>/                                      ← f | r | S
      <entityId>/                                      ← numeric post-prioritise; slug pre-prioritise
        <agent>/
          <role>-<sessionUuid>.jsonl                   ← native body (copied at finalisation)
          <role>-<sessionUuid>.meta.json               ← queryable summary
          <role>-<sessionUuid>.tmux.log                ← raw pipe-pane (universal floor)
```

Why machine-global, not `<repo>/.aigon/transcripts/`:
- Survives `git clean -fdx` and `aigon feature-reset` (which both touch in-repo `.aigon/`)
- Doesn't bloat the repo's working tree or `.gitignore` surface
- Mirrors how Claude itself stores transcripts (`~/.claude/projects/`)

Why **NOT** `.aigon/state/`:
- Engine state must stay small and locked; transcripts are large and append-only
- Engine state is per-repo; transcripts are per-machine

### 5. Keying: numeric ID + (`agentSessionId` or sidecar `sessionName`)

Use **numeric `entityId`** as the primary key. `migrateEntityWorkflowIdSync` re-keys slug → numeric on prioritise (F296), so any pre-prioritise slug-keyed transcript needs to be moved at the same time. The migration hook is the natural place — extend `migrateEntityWorkflowIdSync` to also `mv ~/.aigon/transcripts/.../<slug>/ <numericId>/` if a directory exists.

Filename = `<role>-<sessionUuid>` where:
- `role` = the sidecar's `role` field (`do` | `auto` | `review` | `eval` | `close`) — already populated by `parseTmuxSessionName`
- `sessionUuid` = `agentSessionId` if available, else `sha1(sessionName)[0:12]` so cu/op/km still get a stable key

**One file per agent invocation (= one tmux session = one sidecar)**, not "one per feature run." A feature can have multiple sessions per agent (do, review, auto, retries after token-exhaustion failover). Each is a discrete, comparable artifact.

### 6. Metadata schema — do not duplicate `lib/telemetry.js`

The headline metrics the dashboard wants — model, turns, tokens, cost, exit, start/end ts — are already produced by `writeNormalizedTelemetryRecord` (`lib/telemetry.js:92`). Today it writes `.aigon/telemetry/{entityType}-{id}-{agent}-{sessionId}.json`. The transcript layer is the *body*; telemetry is the *summary*. New `<role>-<sessionUuid>.meta.json` should be **strict superset of telemetry** plus transcript-specific fields:

```json
{
  "schemaVersion": 1,
  "telemetryRef": ".aigon/telemetry/feature-364-cc-<sid>.json",
  "sessionName": "aigon-f364-do-cc-...",
  "tmuxId": "$1455",
  "agentSessionId": "8ee3630e-...",
  "nativeBodyBytes": 217843,
  "tmuxBodyBytes": 1840201,
  "redactedRanges": [{"start": 1024, "end": 1078, "kind": "env"}],
  "complete": true,
  "finalisedAt": "2026-04-26T12:34:56Z",
  "finalisedBy": "feature-close"
}
```

The dashboard answers all the headline questions (per-agent failure modes, spec-quality correlation, stuck-detection) by joining telemetry rows + meta sidecars. Transcript bodies stay on disk; the read path opens them only on user click.

### 7. Wire-up: one new step in `createDetachedTmuxSession`

Two changes to `lib/worktree.js:1211`:

```js
// after the tmuxId capture block, before the sidecar write:
if (transcriptCaptureEnabled(meta.repoPath)) {
    const tmuxLogPath = transcriptTmuxPathForSession(meta);  // ~/.aigon/transcripts/<repo>/.../<role>-<sessionUuid>.tmux.log
    fs.mkdirSync(path.dirname(tmuxLogPath), { recursive: true });
    runTmux(['pipe-pane', '-t', tmuxId, '-O', `cat >> ${shellQuote(tmuxLogPath)}`], { stdio: 'ignore' });
}
```

And one change to `lib/feature-close.js` — at finalisation, copy the *current* `agentSessionPath` body into the durable hot tier (file copy, not move; native log keeps living in `~/.claude/projects/`). Same hook can write the `.meta.json` sibling by reading the matching telemetry record.

### 8. Privacy & opt-in

Default posture:
- **Hot tier (local) ON by default** — we're already pointing at these files via the sidecar; copying them locally has no new privacy boundary
- **Cold tier (S3/R2/GCS) OFF by default and OFF unless `aigon transcripts upload-config` is run** — different security surface entirely
- **Redaction: at *export* time, not capture time** — the local hot copy is verbatim (matches Claude's own behaviour); redaction runs only when the user runs `aigon transcripts export <key>` or when the cold uploader fires
- **Redaction patterns**: regex against known credential prefixes (`AKIA`, `gh[ps]_`, `sk-`, `glpat-`), values for any key in any `.env*` discovered in the worktree, and lines containing the worktree's `.env.local` content verbatim
- **Deletion**: `aigon transcripts delete <key>` removes both `.jsonl` body, `.tmux.log`, `.meta.json`, and the cold-tier copy if uploaded
- **Read-only dashboard rule** is preserved — dashboard reads transcripts via a new `dashboard-status-collector.js` reader; never writes, never redacts, never deletes (those are CLI commands)

### 9. Headline features unlocked, ranked

1. **Quarantine evidence trail** (small, ships first) — when `aigon agent quarantine <id> <model>` fires (F358), snapshot the *current* transcripts of any active sessions for that agent into `~/.aigon/transcripts/<repo>/quarantine/<timestamp>-<model>/`. This is the "audit evidence when a model misbehaves" use case stated in the brief, and the smallest possible feature that justifies the storage layer existing.
2. **Stuck-detection upgrade** (small) — supervisor's idle detection currently uses heartbeat sidecar files. Adding "transcript byte-count hasn't advanced for N min while pane is alive" is a stronger signal than gap-on-heartbeat, and falls out for free once `pipe-pane` is wired. Display-only badge per the existing rule that idle never auto-acts.
3. **Resume after crash** — already shipped (F357). Don't re-build.
4. **Side-by-side reasoning compare** (medium) — Fleet-mode `feature-eval` could open both transcripts side-by-side in the dashboard. Useful but not load-bearing.
5. **Spec→outcome correlation dashboard** (large) — needs N=hundreds of runs and a cold tier; defer until 2 + 3 prove the infrastructure is reliable.
6. **Replay for debugging shipped-broken features** (large) — high cost, low ROI; the diff + run-log already cover most "what went wrong" investigations. Defer indefinitely.

### 10. Cost model

- Typical Claude session JSONL: 200 KB – 2 MB. p99 (long autonomous runs): ~50 MB.
- Typical tmux pipe-pane log: 5–10× the native body (ANSI overhead + redraw spam). p99: ~500 MB.
- Realistic weekly load: 10 features × 4 agents × 2 MB native + 10 MB tmux ≈ **480 MB/wk hot**. Lifecycle policy: keep hot for 90 days, archive to cold (or delete) after.
- Cold tier (R2): ~$0.015/GB/mo. 480 MB/wk × 52 wk = ~25 GB/yr = **$0.40/yr storage**, $0 egress on R2. Negligible.
- "Lite" mode: just don't enable `pipe-pane` (skip the `.tmux.log`); keep the native body + meta only. Brings hot footprint down ~10×.

## Sources

- `lib/session-sidecar.js` — F357 sidecar binding + `resolveResumeArgs`
- `lib/telemetry.js` — `resolveClaudeProjectDir`, `resolveGeminiChatsDir`, `findCodexSessionFiles`, `writeNormalizedTelemetryRecord`
- `lib/worktree.js:1211` (`createDetachedTmuxSession`) — single spawn chokepoint
- `lib/feature-close.js` — natural finalisation hook
- `lib/workflow-core/migrateEntityWorkflowIdSync` — slug→numeric re-keying (F296)
- `AGENTS.md` § State Architecture — engine-state vs additive-state separation rule
- `AGENTS.md` § Dashboard read-only rule — read-side reader belongs in `dashboard-status-collector.js`

## Recommendation

**Do not build a parallel capture pipeline.** Extend the existing sidecar layer with a durable hot tier and a tmux floor. Ship in three small features, defer cold tier until usage proves it out.

- **F-A (small, ~150 LOC)**: Add `cu` (and stub `op`, `km`) to `CAPTURABLE_AGENTS` with sensible no-op behaviour where no native log exists. Audit the actual cu transcript path during implementation — if Cursor writes one, wire it; if not, mark cu as "tmux-only" and rely on F-B.
- **F-B (small, ~250 LOC)**: Wire `tmux pipe-pane` into `createDetachedTmuxSession`. Output to `~/.aigon/transcripts/<repo>/.../tmux.log`. Opt-out via `~/.aigon/config.json:transcripts.tmux=false`. Hook supervisor stuck-detection to read byte-growth as a secondary signal (display-only badge per existing rule).
- **F-C (medium, ~500 LOC)**: At `feature-close` and at `agent quarantine`, copy the current `agentSessionPath` body into the durable hot tier and write the `.meta.json` sibling joining the existing telemetry record. Add `aigon transcripts list|show|delete|export` CLI. Extend `migrateEntityWorkflowIdSync` to rename slug→numeric directory at the same atomic moment.
- **F-D (large, defer)**: Cold tier (R2/S3 upload), redaction-at-export, spec-quality dashboard. Wait for 90 days of F-C data before scoping.

The order matters: F-B is the universal floor, F-A normalises the heterogeneity, F-C delivers the first user-facing feature (quarantine evidence), F-D is speculative until usage data exists.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| transcript-tmux-pipe-pane | Wire `tmux pipe-pane` into `createDetachedTmuxSession` to capture raw ANSI to `~/.aigon/transcripts/<repo>/.../tmux.log` outside the worktree; opt-out config; supervisor reads byte-growth as a stuck-detection signal | high | none |
| transcript-cu-capture | Audit Cursor's native transcript path (if any) and add `cu` to `CAPTURABLE_AGENTS`; stub `op` and `km` so the matrix is uniform | medium | transcript-tmux-pipe-pane |
| transcript-durable-hot-tier | At `feature-close` and `agent quarantine`, copy `agentSessionPath` body + write `.meta.json` joining the telemetry record into `~/.aigon/transcripts/<repo>/<entityType>/<entityId>/<agent>/<role>-<uuid>.*`; survives worktree deletion and native log rotation; extend `migrateEntityWorkflowIdSync` to rename slug→numeric directory atomically | high | transcript-tmux-pipe-pane |
| transcript-cli | `aigon transcripts list\|show\|delete\|export` for managing the hot tier; export pass runs redaction (env values, known credential prefixes, `.env.local` content) | medium | transcript-durable-hot-tier |
| transcript-quarantine-evidence | When `aigon agent quarantine` fires, snapshot all active sessions for that agent under `~/.aigon/transcripts/<repo>/quarantine/<ts>-<model>/`; the audit-trail use case from the brief | medium | transcript-durable-hot-tier |
| transcript-stuck-detection-signal | Supervisor reads transcript byte-growth as secondary signal alongside heartbeat; display-only badge in dashboard, never auto-acts | low | transcript-tmux-pipe-pane |
| transcript-cold-tier-upload | Opt-in S3/R2/GCS uploader with redaction-at-export; lifecycle policy (hot 90d → cold/delete); `aigon transcripts upload-config` to enable | low | transcript-cli |
