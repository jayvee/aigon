---
complexity: high
---

# Research: state-engine-sqlite-migration

## Context

Aigon has tried 4–7 times to make the workflow engine the sole source of truth for entity state, most recently via F294 (compat-half-state removal), F296 (slug-keyed inbox bootstrap), and F397 (engine-first lifecycle precedence in `isEntityDone`). Each pass seals one set of producers, and a new code path then reads folder location directly — because the folder is *always there* and `readdirSync('02-backlog/')` is the shortest line of code that "works." The drift between folder location, workflow snapshots, JSON sidecars, tmux/session names, and spec frontmatter is now structural, not behavioural.

The revised strategic direction is **not** to make SQLite the sole durable source of truth for all Aigon state. The safer architecture is:

> **Markdown specs/logs and workflow events remain the durable, inspectable repo artifacts. SQLite becomes the rebuildable relational projection, integrity index, and fast read model.**

Concretely, this research should assume:

- **Specs stay in Git as markdown.** Feature, research, feedback, recurring, eval, review, closeout, and implementation-log prose remains file-backed because human-readable diffs, manual editing, agent context, and recovery are core product properties.
- **Workflow events stay durable and inspectable.** JSONL event logs remain the audit trail unless this research proves a strictly better append-only representation. SQLite may index events, but must not be the only place lifecycle history exists in the first rollout.
- **SQLite is a repo-local projection/index.** Prefer one DB per repo, e.g. `.aigon/state/aigon.db` or `.aigon/cache/aigon.db`, rebuilt from specs, workflow events, snapshots, sidecars, sessions, and telemetry. The DB owns relational identity, link resolution, integrity findings, and fast dashboard/report queries.
- **Paths are attributes, not identity.** The DB references specs/logs by stable logical identity (`repo_id`, `entity_type`, `entity_id`, document type) plus relative path, hash, and mtime. Folder/stage path is never the entity identity.
- **Cross-repo reports use a global aggregate cache.** A machine-level DB under `~/.aigon/cache/` may aggregate report facts from repo-local DBs, but remains rebuildable and non-authoritative.
- **Server sync is a future event/fact sync seam, not SQLite-file sync.** If Aigon later supports multi-user server mode, local SQLite should sync domain events/facts through an outbox/cursor API to a server database (likely Postgres), not replicate the SQLite file itself.
- **Rejected for the first architecture:** Dolt as the runtime store (extra database/version-control dependency), shared/network SQLite as a multi-user store (locking/corruption/latency risks), SQLite-file replication as the product sync layer, and moving all spec/log content into DB rows.

This research must convert that direction into a sequenced, concrete feature plan — not a single mega-feature, and not five features in the wrong order.

## Questions to Answer

### Schema & data model
- [ ] What tables are needed to represent every existing entity type — features, research topics, recurring features, dependencies, workflow snapshots, events, sessions, feedback, reviews, documents, worktrees, transcripts, and telemetry summaries?
- [ ] What is the stable identity model (`repo_id`, `entity_type`, `entity_id`, slug, path aliases) and how does it handle padded/unpadded IDs, inbox slug IDs, repo moves, and re-registration?
- [ ] Which tables are strictly projections (rebuildable from files/events) vs. local runtime caches (sessions, worktrees, last poll state) vs. future authoritative server facts? Where exactly is the boundary?
- [ ] What is the indexed-events table schema (id, entity_type, entity_id, event_type, payload_json, ts, actor, machine_id, source_path, source_offset/hash) and what invariants make it deterministically rebuildable from JSONL?
- [ ] What is the `entity_documents` schema for specs/logs/reviews/evals/closeouts: logical document type, relative path, hash, mtime, parsed title, frontmatter JSON, indexed text version?
- [ ] What is the `entity_links` schema for `depends_on`, research-origin links, set membership, blocked-by relationships, review/session links, worktree links, and future server-side relations?
- [ ] How do recurring features model the parent/template relationship and the per-week instances?
- [ ] Which SQLite features should v1 require: foreign keys, WAL mode, STRICT tables, generated columns, JSON functions, FTS5? Which Node binding (`better-sqlite3` vs alternatives) best fits Aigon's synchronous CLI paths?

### Disk artifacts & indexing contract
- [ ] What is the canonical filename convention for each entity/document type, and which tokens are identity vs. human-readable affordance vs. historical stage projection?
- [ ] Which frontmatter fields remain intentionally file-backed because agents/users edit them (`complexity`, `depends_on`, `research`, `set`, etc.) and which should be deprecated as duplicated structured state?
- [ ] How do humans/agents create a new spec: CLI command writes markdown + workflow event + DB index update, with DB update failures marking the index dirty rather than corrupting workflow state?
- [ ] How do manual edits flow? Define hash/mtime-based re-indexing, stale row detection, and when a changed file should trigger link/integrity recalculation.
- [ ] Inventory every existing sidecar file type (eval reports, review summaries, 7-section logs, recurring manifests, feedback artifacts, dependency notes, anything else under `docs/specs/`). For each, decide: index prose only, extract structured fields into DB, or leave unindexed.
- [ ] Are there current disk artifacts that exist *only* as machine-readable indexes (status caches, cross-reference files, generated graphs)? Which can be replaced by DB projection once safe?
- [ ] What is the exact two-storage consistency contract: durable truth, projection, dirty marker, rebuild, and doctor repair behaviour?

### Migration & rollout
- [ ] What is the migration path from today's JSON-files-in-folders state to the new repo-local projection DB? One-shot `aigon index rebuild`, `doctor --fix`, server-start lazy rebuild, or all three?
- [ ] How do existing installations upgrade without losing in-flight feature state, especially across the staged feature rollout?
- [ ] What is the rollback story if the indexer uncovers data the schema can't represent? Since DB is projection, when should Aigon move the DB aside and rebuild vs. fail loudly?
- [ ] Does the migration tool need to be idempotent / resumable for users with large spec histories?
- [ ] Where should the DB live (`.aigon/state/aigon.db` vs `.aigon/cache/aigon.db`) and should it be gitignored by default?
- [ ] What happens when a repo is removed from the dashboard and later re-added? Define unregister vs. purge semantics.
- [ ] How does a repo moved to a new machine recover history from committed specs/events and optional backup/sync artifacts?

### Read-path port
- [ ] How does the dashboard read-model (`buildMissingSnapshotState`, `dashboard-status-collector`, etc.) port across? Which queries move to SQLite first while preserving file-scanner fallback?
- [ ] How do CLI commands (`feature-list`, `feature-status`, `feature-close`, `research-*`, `doctor --fix`) get rewritten? Which command surfaces change, which stay identical?
- [ ] What happens to the 7-section log format — stays as a markdown sidecar indexed by DB, or splits into prose + structured extracted rows? What does F332 imply?
- [ ] How does `aigon doctor --fix` change shape when it can report both source-of-truth drift and projection/index drift?
- [ ] Which cross-repo report queries should read from a global aggregate cache, and what is the refresh/parity contract against repo-local DBs?
- [ ] What parity tests prove SQLite-backed status/detail/dependency/report output matches the current collectors before readers are switched?

### Optional view generator
- [ ] Is a regenerated kanban/finder view still needed if the existing `docs/specs/...` folder layout remains? If yes, is it a symlink projection, generated index file, or dashboard-only concern?
- [ ] When would an optional view regenerate — on every state transition, on `aigon view`, by a watcher, or all three?
- [ ] How is the view kept honest if a user edits/moves generated artifacts? Snap-back watcher, read-only docs, or no filesystem view?
- [ ] What's the Windows / cross-platform story for symlinks? (Aigon supports macOS + Linux primarily, but worth confirming the failure mode on Windows.)

### Sequencing & feature breakdown
- [ ] What is the minimum first feature that can ship without breaking main? Likely: SQLite store module + schema v1 + full rebuild command + no reader port.
- [ ] What is the right order for the subsequent features — schema, entity/document indexer, relationship extractor, integrity reports, dashboard read adapter, command write hooks, global report cache, optional view generator?
- [ ] Can any of the work happen in parallel safely, or is it strictly sequential?
- [ ] Where is the point-of-no-return — the feature that removes or greatly narrows folder-as-state fallback? What parity gates and doctor recovery gates must pass first?

### Testing & quality
- [ ] How do unit/integration tests use the DB — in-memory SQLite per test, fixture file, or transactional rollback?
- [ ] How does `npm run test:iterate` stay fast under the new model?
- [ ] What is the equivalent of today's "snapshotless drift detection" when the DB is rebuildable and may be stale, dirty, missing, or corrupt?
- [ ] What corruption tests prove an unreadable DB is moved aside and rebuilt without data loss?
- [ ] What manual-edit tests prove mtime/hash changes re-index specs/logs and update entity links?

### Global cache & multi-user seam (deferred work, but design now)
- [ ] What global aggregate tables support all-repo reports without making the machine cache authoritative?
- [ ] What does the future sync outbox/cursor API look like? Define the seam so schema choices today don't preclude server sync.
- [ ] Which facts/events would sync to a remote server: workflow events, entity metadata, relationship facts, agent runs, telemetry summaries, integrity findings?
- [ ] Confirm: are `machine_id`, `actor`, `source`, and `sync_status` worth carrying from day one, or added later when sync ships?
- [ ] Which server database shape is implied by this model (likely Postgres), and which local DB tables must not leak local-only paths or machine-only assumptions into synced facts?

## Scope

### In Scope
- Schema design for all existing entity types and their relationships
- Repo-local SQLite projection/index design and rebuild contract
- Event indexing design over existing workflow JSONL
- Markdown/document indexing and two-storage consistency contract
- Migration/index-backfill strategy from existing specs, snapshots, sidecars, sessions, and telemetry
- Dashboard read-model port plan with fallback/parity testing
- CLI command port plan
- Cross-repo global aggregate cache design for reports
- Optional symlink/view generator design
- Sequenced breakdown into shippable features (with explicit ordering rationale)
- Testing strategy under the new model
- Confirming `better-sqlite3` is the right embedded SQLite binding for Node CLI use
- Future server-sync seam at the event/fact level

### Out of Scope
- **Multi-machine/server sync implementation** — design the outbox/cursor seam, don't build it.
- **Dolt / cr-sqlite / cloud-backed alternatives as v1 runtime store** — evaluate only enough to justify rejection/deferral.
- **Linear / Jira / GitHub Issues as backend** — rejected; conflicts with local-first identity.
- **Moving spec/log prose into the DB as the only copy** — specs/logs stay as markdown artifacts; DB indexes them.
- **Using shared/network SQLite as a multi-user database** — rejected for locking/corruption/latency reasons.
- **Dashboard visual redesign** — read-path and state architecture only.

## Inspiration

- F294 (compat-half-state removal), F296 (slug-keyed inbox bootstrap), F397 (engine-first lifecycle precedence) — the three most recent attempts to seal folder-as-state leaks. The patterns of where leaks recurred are the strongest input to schema and read-path design.
- `AGENTS.md` § Write-Path Contract — the principle this research operationalises permanently.
- `lib/workflow-core/entity-lifecycle.js` (`isEntityDone`) — current centralised lifecycle precedence; informs how the new model collapses precedence into a single SQL query.
- `lib/dashboard-status-collector.js`, `lib/workflow-read-model.js` — current read-model surface that needs to port.
- Conversation transcript with John on 2026-04-30 capturing the strategic decision and the four-layer architecture (specs → events → DB → view).
- Follow-up architecture discussion on 2026-06-18 revising the earlier "SQLite as single source of truth" direction: repo-local SQLite should be a rebuildable relational projection/index; markdown specs/logs and workflow events remain durable repo artifacts; global reports use a machine aggregate cache; future multi-user sync should sync events/facts to a server DB rather than replicate SQLite files.

## Findings

<!-- To be filled in by the research-do agent. -->

## Recommendation

<!-- To be filled in by the research-do agent. -->

## Output

<!-- Based on findings, create sequenced feature specs via `aigon feature-create "<name>"`. Link the created files below. -->
- [ ] Feature:
