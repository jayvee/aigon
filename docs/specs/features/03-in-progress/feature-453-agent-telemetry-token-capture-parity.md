---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-29T10:23:57.500Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-telemetry-token-capture-parity

## Summary

Bring full token-usage capture to gg and op so F443's tokens-in / tokens-out / $ columns in the benchmark matrix are no longer sparse. cc already works as of 2026-04-29 (all five models show populated tokenUsage in bench results) via its `SessionEnd` hook → `aigon capture-session-telemetry` → normalized records in `.aigon/telemetry/`. cx has been working via `parseCodexTranscripts` since F438.

**gg root cause (two bugs):** (1) Gemini CLI has no `SessionEnd` event — only `SessionStart` and `AfterAgent` — so no hook ever writes to `.aigon/telemetry/`, leaving `aggregateNormalizedTelemetryRecords` with nothing to read. (2) The existing fallback `parseGeminiTranscripts` → `resolveGeminiChatsDir` never succeeds at Strategy 1 because the code hashes the path with SHA256 but Gemini uses a different algorithm (confirmed: `sha256(path) ≠ dir name`). Strategy 2 (`.project_root` scan) is the viable read path but has path-normalisation gaps and a timing race on freshly created bench worktrees.

**op root cause (missing implementation):** OpenCode persists full session data in a SQLite database at `~/.local/share/opencode/opencode.db`. The `message` table stores per-message token breakdown (`tokens.input / output / cache.read / cache.write / reasoning`) plus model ID and timestamp as JSON in a `data` column, linked via `session` → `project` tables that record the project path. 18 k+ messages with complete token data exist already. Currently `op.json` has `transcriptTelemetry: false` and no `telemetryStrategy`; nothing ever queries the DB.

## User Stories

- [ ] As a user running bench sweeps across all agents, I want the benchmark JSON and matrix to show token counts and cost for gg and op runs, so I can compare efficiency and cost across Claude, Gemini, and OpenRouter models on the same task.
- [ ] As a user viewing the benchmark dashboard, I want the tokens-in / tokens-out / $ columns populated for gg and op rows alongside cc and cx, so the matrix isn't misleadingly sparse and I can make informed model selection decisions.

## Acceptance Criteria

- [ ] A brewboard bench run with agent gg produces a `tokenUsage` object with non-null `inputTokens`, `outputTokens`, `billableTokens`, and `costUsd` in the benchmark result JSON.
- [ ] A brewboard bench run with agent op produces a `tokenUsage` object with non-null `inputTokens`, `outputTokens`, and `costUsd` in the benchmark result JSON.
- [ ] `resolveGeminiChatsDir(worktreePath)` returns a valid path for a worktree that was freshly created by a bench run (Strategy 2 handles normalisation; new fallback handles timing gaps).
- [ ] `parseOpenCodeDb(worktreePath, { afterMs })` returns aggregated token usage for an op bench run that completed after `afterMs`.
- [ ] `op.json` has `capabilities.transcriptTelemetry: true` and `runtime.telemetryStrategy: "opencode-db"`.
- [ ] The gg AfterAgent hook fires during a bench run and writes at least one normalized record to `.aigon/telemetry/` before the bench polls for telemetry.
- [ ] All existing tests pass; cc and cx bench telemetry is unaffected.

## Validation

```bash
npm test
# Smoke: run a single gg bench and verify tokenUsage is present
node aigon-cli.js perf-bench brewboard 07 gg --model gemini-2.5-flash 2>&1 | tail -20
node -e "
  const fs = require('fs'), glob = require('glob');
  const files = glob.sync('.aigon/benchmarks/brewboard-07-*.json', { cwd: require('os').homedir() + '/src/brewboard' });
  const last = JSON.parse(fs.readFileSync(files.sort().pop()));
  if (!last.tokenUsage || !last.tokenUsage.outputTokens) { console.error('FAIL: no gg tokenUsage'); process.exit(1); }
  console.log('PASS gg:', last.tokenUsage);
"
# Smoke: run a single op bench and verify tokenUsage is present
node aigon-cli.js perf-bench brewboard 07 op --model openrouter/deepseek/deepseek-chat-v3.1 2>&1 | tail -20
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### GG — two-part fix

**Part A: `capture-gemini-telemetry` command + AfterAgent hook**

Since Gemini CLI has no `SessionEnd`, use `AfterAgent` (fires after every model response). Add a new command `aigon capture-gemini-telemetry` in `lib/commands/misc.js`:

1. Reads `process.cwd()` as the project/worktree path.
2. Determines `featureId`, `agentId`, `entityType`, `activity` from the current git branch name using the same regex as `captureSessionTelemetry` (pattern: `feature-(\d+)-gg-(.+)`). Returns early if branch doesn't match.
3. Calls `telemetry.parseGeminiTranscripts(cwd, { featureId, repoPath, entityType, activity })`. This function already writes one normalized record per session using the Gemini `sessionId` as the filename key — repeated AfterAgent firings overwrite the same record, so the final firing wins with the complete session data.

In `templates/agents/gg.json`, add a second hook command to the existing `AfterAgent` entry (the array inside the `"matcher": ".*"` hooks array):
```json
{ "type": "command", "command": "aigon capture-gemini-telemetry", "timeout": 15 }
```

The `install-agent` command writes from `extras.settings.hooks` to `.gemini/settings.json` in seed repos; adding this hook to the template ensures new installs pick it up. For existing seed repos (brewboard) update `.gemini/settings.json` directly (or re-run `install-agent`).

**Part B: Fix `resolveGeminiChatsDir` in `lib/telemetry.js`**

Strategy 1 (SHA256 hash match) never works — remove or skip it. Harden Strategy 2:
- Per-directory try/catch so a single unreadable `.project_root` doesn't abort the scan.
- Normalise both sides of the path comparison: `path.resolve()` + strip trailing slash on both the stored value and the input `projectPath`.
- Add Strategy 3 as a timing-gap fallback: when Strategy 2 finds nothing (`.project_root` not yet written for a fresh bench worktree), scan `~/.gemini/tmp/*/chats/*.json` for the session file whose `startTime` falls within the last `options.afterMs`-ms window. Return the parent `chats/` dir.

**Part C: Pricing for gg models**

Gemini model IDs in chat files are already handled by `getModelPricing` family fallbacks (`includes('gemini')`). No change needed.

---

### OP — SQLite parser

**New `parseOpenCodeDb(worktreePath, options)` in `lib/telemetry.js`**

DB location: `~/.local/share/opencode/opencode.db` (read-only).

Schema used:
- `project` table — find rows where the path column matches `path.resolve(worktreePath)`
- `session` table — sessions for that `projectId`; filter `createdAt > options.afterMs` (milliseconds)
- `message` table — assistant messages for those sessions where `json_extract(data, '$.tokens') IS NOT NULL`; extract `json_extract(data, '$.tokens')` and `json_extract(data, '$.model.modelID')`

Aggregation:
```
inputTokens    = sum(tokens.input)
outputTokens   = sum(tokens.output)
cacheReadInput = sum(tokens.cache.read)
cacheWriteInput= sum(tokens.cache.write)
thinkingTokens = sum(tokens.reasoning)
totalTokens    = sum(tokens.total)
billableTokens = inputTokens + outputTokens + thinkingTokens
costUsd        = computed via computeCost(aggregated, getModelPricing(lastModelId))
```

Per session, call `writeNormalizedTelemetryRecord({ source: 'opencode-db', sessionId, agent: 'op', ... })` using the OpenCode session ID as the key. Return the same aggregated shape as other parsers.

**SQLite access**: Check `package.json` for `better-sqlite3` before implementation. If present, use it (synchronous API matches the rest of `telemetry.js`). If not, shell out to `sqlite3 <db> -json "<query>"` via `spawnSync` as a zero-dep fallback. Do NOT add `better-sqlite3` as a prod dependency just for this feature without verifying it doesn't conflict with existing tooling.

**Pricing gap**: OpenCode DB stores model IDs without the `openrouter/` prefix (e.g. `qwen/qwen3-coder:exacto`, `x-ai/grok-code-fast-1`). `getModelPricing` has no OpenRouter-specific family fallbacks. Fix: add family-level matches for known OpenRouter providers used by op (deepseek, qwen, grok, mistral, devstral) by checking `modelId.includes(...)`, same pattern as the existing gemini/gpt-5/haiku branches. Alternatively, resolve the model from `op.json`'s `cli.modelOptions[].pricing` by matching the modelID. Document the chosen approach in a comment.

**`captureAgentTelemetry` dispatch** in `lib/telemetry.js`:

Add alongside the existing `gemini-transcript` and `codex-transcript` cases:
```javascript
} else if (tStrat === 'opencode-db' && hasTranscript) {
    const worktree = options.worktreePath || options.repoPath;
    if (worktree) {
        const dbOpts = { featureId, entityType: 'feature', repoPath: options.repoPath, linesChanged };
        if (options.afterMs != null) dbOpts.afterMs = options.afterMs;
        const transcriptData = parseOpenCodeDb(worktree, dbOpts);
        if (transcriptData) Object.assign(result, transcriptData);
    }
}
```

**`op.json` changes**:
```json
"transcriptTelemetry": true,
"telemetryStrategy": "opencode-db"
```

---

### What does NOT change

- `aggregateNormalizedTelemetryRecords` — primary read path; no changes needed. Once hooks/parsers write records, this path works automatically.
- `normalizeCapturedTelemetryUsage` / `waitForBenchmarkTelemetryUsage` in `perf-bench.js` — no changes needed.
- Pricing tables for cc/cx — untouched.
- Feature log frontmatter updates — `capture-gemini-telemetry` intentionally does NOT update log frontmatter (bench sessions aren't feature worktrees tracked by logs; the `captureSessionTelemetry` log-update path is cc-specific and driven by the feature worktree branch context).

## Dependencies

- F443 (benchmark matrix token columns) — done; this feature populates those columns for gg and op.

## Out of Scope

- km — still no headless probe path.
- Direct-API fallback for quota awareness (deferred, F442's open question).
- Backfilling historical bench records — only future runs benefit.
- OpenCode hook/plugin system — not available; SQLite DB is the only viable path.

## Open Questions

- Does `better-sqlite3` exist in `package.json`? Determines whether to use it or shell out to `sqlite3` CLI. Resolve at implementation start.
- What is the exact column name for project path in the OpenCode `project` table? (Likely `path` or `workdir` — confirm with `.schema project` before writing the query.)
- Should `capture-gemini-telemetry` also update log frontmatter (cumulative token totals in the feature log), or leave that as cc-only? Currently scoped out; revisit if gg feature sessions need the same log enrichment.

## Related

- Research: <!-- none — triggered by direct observation of sparse bench output -->
- Set: <!-- standalone -->
- Prior features in set: F438 (token axis + judge), F442 (matrix token columns), F443 (signal health telemetry), F451 (cc bench telemetry confirmed working)
