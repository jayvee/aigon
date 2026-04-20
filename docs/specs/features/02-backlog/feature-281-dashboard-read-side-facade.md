# Feature: dashboard-read-side-facade

## Summary

`lib/dashboard-server.js` performs **58 direct `fs.readFileSync` / `fs.readdirSync` calls** against `.aigon/state/`, log directories, and spec folders — but `lib/agent-status.js` is the declared owner of the per-agent state file format, and `lib/dashboard-status-collector.js` is already the declared aggregator for dashboard read paths. This is intrusive coupling flagged as **Issue 1 (Significant)** in the 2026-04-06 modularity review: the dashboard treats engine-private storage as a published contract, so any schema change (new field, renamed file, new heartbeat layout) forces a two-module edit in lockstep.

Relocate state/log/spec reads out of `dashboard-server.js` into the modules that already own those domains. No new abstractions, no new layers — use the seams that already exist.

## Safety principle (non-negotiable)

**This refactor must not change a single API response.** The Playwright e2e suite (`MOCK_DELAY=fast npm run test:ui`) exercises the dashboard views that consume these reads — it is the safety net. Every extraction commit runs the full pre-push check (`npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh`) before landing. Each commit leaves `dashboard-server.js` in a fully-working state. Reverts, not patches, when a commit goes red.

## Ground truth — current state (2026-04-20)

Measured with `grep -c`:

- `lib/dashboard-server.js` — **3,710 lines**, **58** `fs.readFileSync/readdirSync/existsSync/statSync` calls
- `lib/agent-status.js` — owns the `.aigon/state/feature-{id}-{agent}.json` schema (`readAgentStatus`, `writeAgentStatus`, `agentStatusPath`) with atomic-write pattern
- `lib/dashboard-status-collector.js` — **1,167 lines**; already the declared aggregator for dashboard read paths
- `lib/dashboard-status-helpers.js` — **302 lines**; shared helpers for the collector

### Breakdown of the 58 fs calls in `dashboard-server.js`

Not all 58 are problematic. A rough taxonomy from a first pass at `grep -n 'fs\.(readFileSync|readdirSync)' lib/dashboard-server.js`:

- **State / heartbeat reads** (`.aigon/state/…`, heartbeat files) — the intrusive-coupling core. Move to `agent-status.js` or `dashboard-status-collector.js`.
- **Log reads** (`docs/specs/features/logs/`, `…/worktrees/*/logs/`) — move to a log-reader helper owned by the collector.
- **Spec / findings reads** (`docs/specs/features/*/feature-*.md`, research findings) — already half-owned by `feature-spec-resolver.js`; relocate.
- **Done-stage counters** (`fs.readdirSync(doneDir).filter(...)`) — aggregation; belongs in the collector.
- **Legitimate infrastructure reads** (HTML template, icons, global config, project config) — **leave in place**; those are HTTP/static concerns, not engine-state concerns.

The boundary rule: if the read crosses into `.aigon/`, `docs/specs/features/`, or `docs/specs/research/`, it moves. If it's a config file, asset, or template, it stays.

## User Stories
- [ ] As a maintainer, I can add a field to agent status by editing one file (`agent-status.js`); the dashboard picks it up through the collector without parser updates
- [ ] As a contributor, I can read `dashboard-server.js` and see HTTP infrastructure + route dispatch — not file-format parsing
- [ ] As a tester, the dashboard's engine-state reads are exercised through the collector's surface, not through 58 inline `fs` calls interleaved with route handlers
- [ ] As Pro evolves, new state fields (insights timestamps, attention flags) land in one module, not two

## Acceptance Criteria

### Principle ACs

- [ ] **AC1** — Every extraction is an independent commit that passes `node --check aigon-cli.js && npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` on its own. No multi-commit flag day.
- [ ] **AC2** — Each extraction moves read logic **verbatim** — no schema interpretation changes, no response shape changes, no additional fields surfaced. Pure relocation.
- [ ] **AC3** — After every extraction, the Playwright e2e suite still passes without modification.
- [ ] **AC4** — No new "facade" or "service" layer. Reads go to the module that already owns the data: `agent-status.js` (state), `dashboard-status-collector.js` (aggregation), `feature-spec-resolver.js` (specs).
- [ ] **AC5** — `dashboard-server.js` retains only *infrastructure* fs calls (HTML template, icons, global config, project config). Count of state/log/spec fs calls: **0**.
- [ ] **AC6** — `dashboard-server.js` shrinks by at least the LOC of every relocated block (no growth, no stubs).
- [ ] **AC7** — A comment marker at the top of `dashboard-server.js` (e.g. `// no direct fs reads of engine state — use the collector`) makes the boundary visible to future contributors.

### Extractions — by domain, incrementally

Each bullet is a shippable commit.

#### E1 — state/heartbeat reads → `agent-status.js` + collector

- [ ] **E1.1** — Catalog every `.aigon/state/`, heartbeat, and agent-status read in `dashboard-server.js`
- [ ] **E1.2** — Expose `readAgentStatusForEntity(repoPath, entityId)` and `listAgentStatuses(repoPath, entityId)` on `agent-status.js` (or the collector, whichever currently owns the iteration shape)
- [ ] **E1.3** — Replace inline `fs.readFileSync(agentStatePath, 'utf8')` sites in `dashboard-server.js` with calls to the new accessors
- [ ] **E1.4** — Route handlers consume the returned structured data; no JSON parsing in `dashboard-server.js`
- [ ] **E1.5** — Pre-push check passes

#### E2 — log reads → collector helper

- [ ] **E2.1** — Move the log-directory scans (`repoLogDir`, `wtLogDir`, worktree log enumeration) into `dashboard-status-collector.js` as `listEntityLogs(repoPath, entityId, opts)`
- [ ] **E2.2** — `fs.readFileSync(logPath, 'utf8')` for log content reads becomes a helper `readEntityLog(repoPath, entityId, logId)` owned by the collector
- [ ] **E2.3** — Update route handlers to call the helpers
- [ ] **E2.4** — Pre-push check passes

#### E3 — spec / findings reads → `feature-spec-resolver.js`

- [ ] **E3.1** — The `fs.readdirSync(dir).find(f => f.startsWith(prefix))` pattern lives in `feature-spec-resolver.js` already. Consolidate `dashboard-server.js` callers onto its `findSpecFile` / equivalent API
- [ ] **E3.2** — Research findings content reads (`findingsPath`) move into the research equivalent (or a shared helper in the resolver module)
- [ ] **E3.3** — Pre-push check passes

#### E4 — done-stage aggregation → collector

- [ ] **E4.1** — The `doneCount += fs.readdirSync(doneDir).filter(...)` block is aggregation; move into `dashboard-status-collector.js` as `countDoneEntities(repoPath)`
- [ ] **E4.2** — Route handler consumes the counter; no directory iteration in the route
- [ ] **E4.3** — Pre-push check passes

#### E5 — residue sweep

- [ ] **E5.1** — After E1–E4, re-count state/log/spec fs calls in `dashboard-server.js`. Target: zero
- [ ] **E5.2** — Anything surviving is either (a) legitimately infrastructure (leave) or (b) was missed (move)
- [ ] **E5.3** — Add the boundary comment marker (AC7)

### Completion criterion

- [ ] **AC8** — `grep -c 'fs\.readFileSync\|fs\.readdirSync' lib/dashboard-server.js` counts only infrastructure reads (HTML template, icons, global config, project config). No reads against `.aigon/` or `docs/specs/`.
- [ ] **AC9** — CLAUDE.md "Dashboard must be read-only" rule is strengthened: dashboard is read-only with respect to *mutations and engine-state file access*.
- [ ] **AC10** — Module Map in CLAUDE.md updated to note `agent-status.js` + `dashboard-status-collector.js` as the authoritative dashboard read paths.

## Validation

```bash
# After every extraction commit:
node --check aigon-cli.js
node -c lib/dashboard-server.js
node -c lib/agent-status.js
node -c lib/dashboard-status-collector.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh

# Final state:
# Only infrastructure fs reads should remain in dashboard-server.js.
grep -n "fs\.readFileSync\|fs\.readdirSync" lib/dashboard-server.js
# Expect matches for: GLOBAL_CONFIG_PATH, projectConfigPath, htmlTemplate,
# assetFile, icoFile, manifestPath. Nothing against .aigon/state or docs/specs.
```

## Technical Approach

### Prior art

- **`dashboard-status-collector.js`** (1,167 LOC) is already the declared aggregator for dashboard read paths. Several domains are already pulled through it. This refactor completes the extraction rather than inventing a new seam.
- **`agent-status.js`** already owns the state-file schema with atomic-write semantics. Exposing read accessors is a natural extension.
- **`feature-spec-resolver.js`** already owns spec-path lookup. The `startsWith(prefix)` enumeration scattered in `dashboard-server.js` is duplicating logic it already has.

### Mechanical steps per extraction

1. `grep -n 'fs\.(readFileSync|readdirSync)' lib/dashboard-server.js` — find candidate blocks for the domain
2. Identify the owner module (`agent-status.js`, `dashboard-status-collector.js`, or `feature-spec-resolver.js`)
3. Add an accessor to the owner module that returns structured data (not a file path + parse-your-own)
4. Replace the inline fs call in `dashboard-server.js` with the accessor
5. Delete any now-dead local helpers in `dashboard-server.js`
6. Full pre-push check
7. Commit: `refactor(dashboard): relocate <domain> reads to <owner module>`

### What is NOT changing

- **Any API response shape, status code, or header** — pure relocation
- **The agent-status schema itself** — this feature is read-path organization, not schema evolution
- **The `.aigon/state/` file format, file names, or location** — unchanged
- **The collector's existing API** — it gains accessors, nothing is renamed
- **WebSocket protocol, static file serving, HTML template injection** — infrastructure, untouched
- **Mutation paths** — dashboard is already read-only for mutations; this feature doesn't touch that
- **CLI subprocess model** — `spawnSync('aigon ...')` for mutations is the right seam and stays

### Pairing with dashboard-route-table-extract-api-handlers

The sibling feature `dashboard-route-table-extract-api-handlers` extracts route *handlers* out of `dashboard-server.js`. That refactor intersects with this one: once route handlers live in their own module(s), the temptation to inline `fs.readFileSync` right inside a handler is strong. **Land the route-table extraction first**, then this feature's relocations can slot cleanly into the route handlers' calling context (they consume the collector; the collector reads the files).

Doing this feature second also means the route handlers being extracted are already "small" (no file parsing), which reduces the route-table commit size and visible diff per namespace.

## Dependencies

- **Soft**: `dashboard-route-table-extract-api-handlers` (inbox) — ideally lands first so route handlers are the units that consume the collector. Not a hard dep; this feature can still ship independently, just with slightly messier diffs.
- **Hard**: none. `agent-status.js`, `dashboard-status-collector.js`, and `feature-spec-resolver.js` already exist and are already in production.

## Out of Scope

- **Changing the state file schema** — add-a-field evolution is a separate concern; this feature is about removing the seam that makes schema changes painful
- **Replacing `spawnSync` with in-process mutation** — mutation path stays CLI-subprocess; this is explicitly the safe boundary
- **Introducing a general-purpose "repository" or "DAO" pattern** — use the modules that already own the domains; no new abstractions
- **Refactoring `dashboard-status-collector.js` internals** — it's the target, not a source
- **HTML template injection consolidation** — orthogonal
- **WebSocket protocol changes**
- **Caching or memoization of reads** — the dashboard polls every 10s; if caching becomes necessary it's a separate feature with its own invalidation story
- **Per-handler unit tests** — e2e suite covers the behavior; new tests only if a move exposes a gap

## Open Questions

- **Collector vs agent-status.js for state reads** — both are plausible owners. `agent-status.js` owns the single-file schema; the collector owns the aggregation. Default: single-file reads stay with `agent-status.js`, multi-file enumeration lives in the collector. Decide per-extraction based on what reads most cleanly.
- **Log reads — new module or collector?** The collector is already 1,167 LOC and growing. If log reads add >200 LOC, consider `lib/dashboard-log-reader.js` as a focused sibling. Default: start in the collector, split if it exceeds ~1,400 LOC.
- **Done-stage counting belongs where?** Arguably in `workflow-read-model.js` (581 LOC, the read adapter for workflow-core snapshots) rather than the dashboard collector. Decide after E4 when the code is in front of you.

## Related

- **Modularity review**: `docs/modularity-review/2026-04-06/modularity-review.md` — Issue 1 (Significant)
- **Sibling refactor**: `feature-dashboard-route-table-extract-api-handlers` (inbox) — lands first for cleanest diffs
- **Owner modules**: `lib/agent-status.js`, `lib/dashboard-status-collector.js`, `lib/feature-spec-resolver.js`
- **CLAUDE.md** "Dashboard must be read-only" rule — this feature strengthens enforcement
- **CLAUDE.md rule T1** (pre-push tests) — enforced at every extraction commit
- **CLAUDE.md rule T2** (new code ships with a test) — pure relocations are exempted; commit message should call out e2e coverage for moved reads
