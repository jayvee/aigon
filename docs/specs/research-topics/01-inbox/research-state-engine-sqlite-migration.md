---
complexity: high
---

# Research: state-engine-sqlite-migration

## Context

Aigon has tried 4–7 times to make the workflow engine the sole source of truth for entity state, most recently via F294 (compat-half-state removal), F296 (slug-keyed inbox bootstrap), and F397 (engine-first lifecycle precedence in `isEntityDone`). Each pass seals one set of producers, and a new code path then reads folder location directly — because the folder is *always there* and `readdirSync('02-backlog/')` is the shortest line of code that "works." The drift between folder location and engine state is now structural, not behavioural. As long as folder-as-state remains a viable backdoor, agents and humans will reach for it.

The strategic decision (settled, not part of this research) is to move state out of folders entirely, under one governing principle:

> **Nothing structured on disk that the engine cares about.** Disk artifacts are for humans and prose-search; the DB is for the engine and structured queries. The instant a disk artifact starts answering structured queries, it's a future incident.

Concretely:

- **Specs are prose-only markdown.** Body content lives at `specs/feature/<id>.md` (and equivalents for research, recurring, feedback). **No YAML frontmatter, no structured metadata fields on disk** — complexity, agent, owner, status, dependencies, timestamps, all of it is DB-only. The filename carries only the ID and a human-readable slug; it is an identifier, not a status field.
- **State** lives in SQLite (`.aigon/state.db`) as the single source of truth, with **events as a first-class table** so the projection tables (entity state, dependencies, workflow snapshots) are self-rebuildable from within the DB.
- **Sidecar files** (eval reports, code-review summaries, 7-section implementer logs, recurring manifests, etc.) follow the same rule: prose stays on disk if it's useful prose, but every structured field they carry today moves into the DB. Where a sidecar exists *only* to carry structured fields, it stops existing.
- **Kanban view** becomes a regenerated, gitignored symlink projection (`.aigon/view/01-inbox/...`) — purely an ergonomic affordance for VS Code/Finder, never read by the engine.
- **Multi-machine sync is deferred.** The events table makes a future JSONL export hook for git-mergeable interchange straightforward; do not build it now.
- **Library:** `better-sqlite3` (synchronous, single-file, zero-config) — confirm in research, but don't re-litigate.
- **Rejected** (do not revisit): Dolt (runtime Go-binary dependency breaks `npm install` identity), cr-sqlite (premature CRDT complexity), Linear/Jira/GitHub Issues (gives up local-first identity), continuing on JSON-files-in-folders (the current failure mode), keeping frontmatter on disk "just for convenience" (structurally identical to the folder-as-state trap).

This research must convert that strategic direction into a sequenced, concrete feature plan — not a single mega-feature, and not five features in the wrong order.

## Questions to Answer

### Schema & data model
- [ ] What tables are needed to represent every existing entity type — features, research topics, recurring features, dependencies, workflow snapshots, events, sessions, feedback, reviews?
- [ ] What is the events table schema (id, entity_type, entity_id, type, payload_json, ts, machine_id, …) and what invariants make it deterministically replayable?
- [ ] Which tables are projections (rebuildable from events) vs. authoritative (e.g. spec content references, session metadata)? Where exactly is the boundary?
- [ ] How do recurring features model the parent/template relationship and the per-week instances?
- [ ] **Frontmatter migration:** every structured field currently in spec frontmatter (`complexity`, `agent`, etc.) needs a column or table. Enumerate the full set across feature/research/recurring/feedback templates and confirm nothing is lost.

### Disk artifacts (prose-only contract)
- [ ] What is the canonical filename convention for each entity type? Confirm it carries only ID + slug — no stage, status, or other state-bearing tokens.
- [ ] How do humans/agents *create* a new spec when there's no frontmatter to fill in? CLI command writes the prose skeleton + DB row in one transaction?
- [ ] How do edits flow? If a user edits the body in VS Code, does the engine notice / care? Hash-based drift detection, or just "body is unmanaged prose, edit freely"?
- [ ] Inventory every existing sidecar file type (eval reports, review summaries, 7-section logs, recurring manifests, feedback artifacts, dependency notes, anything else under `docs/specs/`). For each, decide: stays as prose, moves to DB entirely, or splits (prose stays, structured fields move).
- [ ] Are there any current disk artifacts that exist *only* as machine-readable indexes (e.g. status caches, cross-reference files)? Those should be deleted outright once the DB exists.

### Migration & rollout
- [ ] What is the migration path from today's JSON-files-in-folders state to the new DB? One-shot `aigon migrate`, or backfill-on-read?
- [ ] How do existing installations upgrade without losing in-flight feature state, especially across the staged feature rollout?
- [ ] What is the rollback story if the migration uncovers data the new schema can't represent?
- [ ] Does the migration tool need to be idempotent / resumable for users with large spec histories?

### Read-path port
- [ ] How does the dashboard read-model (`buildMissingSnapshotState`, `dashboard-status-collector`, etc.) port across? Is the read-model still needed, or does the DB *become* the read-model?
- [ ] How do CLI commands (`feature-list`, `feature-status`, `feature-close`, `research-*`, `doctor --fix`) get rewritten? Which command surfaces change, which stay identical?
- [ ] What happens to the 7-section log format — stays as a markdown sidecar (in `specs/`), or moves into the DB? What does F332 imply?
- [ ] How does `aigon doctor --fix` change shape when there are no folder/engine half-states left to reconcile?

### Symlink view generator
- [ ] When does the view get regenerated — on every state transition, on `aigon view`, by a watcher, or all three?
- [ ] How is the view kept honest if a user `mv`s a symlink? Snap-back watcher, or just document "view is read-only"?
- [ ] What's the Windows / cross-platform story for symlinks? (Aigon supports macOS + Linux primarily, but worth confirming the failure mode on Windows.)
- [ ] Should the view include status badges or just the kanban columns? What's the minimum that preserves the v1 "look at the folder" affordance?

### Sequencing & feature breakdown
- [ ] What is the minimum first feature that can ship without breaking main? (e.g. introduce events table alongside existing state, dual-write, no readers ported yet.)
- [ ] What is the right order for the subsequent features — schema, migration tool, dashboard port, CLI port, view generator, old-state-removal?
- [ ] Can any of the work happen in parallel safely, or is it strictly sequential?
- [ ] Where is the point-of-no-return — the feature that removes the folder-as-state fallback entirely? What gates that ship?

### Testing & quality
- [ ] How do unit/integration tests use the DB — in-memory SQLite per test, fixture file, or transactional rollback?
- [ ] How does `npm run test:iterate` stay fast under the new model?
- [ ] What is the equivalent of today's "snapshotless drift detection" in a world where every entity is in the DB by construction?

### Multi-machine seam (deferred work, but design now)
- [ ] What does the future JSONL export/import hook look like? Define the seam so the schema choices today don't preclude it.
- [ ] Confirm: is `machine_id` on events worth carrying from day one, or added later when sync ships?

## Scope

### In Scope
- Schema design for all existing entity types and their relationships
- Events table design and self-rebuild contract
- Migration strategy from JSON-files-in-folders to SQLite
- Dashboard read-model port plan
- CLI command port plan
- Symlink view generator design
- Sequenced breakdown into shippable features (with explicit ordering rationale)
- Testing strategy under the new model
- Confirming `better-sqlite3` is the right embedded SQLite binding for Node CLI use

### Out of Scope
- **Multi-machine sync implementation** — JSONL export hook is a future feature; design the seam, don't build it.
- **Dolt / cr-sqlite / cloud-backed alternatives** — already evaluated and rejected; do not re-open.
- **Linear / Jira / GitHub Issues as backend** — rejected; conflicts with local-first identity.
- **Moving spec content into the DB** — specs stay as flat markdown. Only *state* moves.
- **Dashboard visual redesign** — the kanban projection is a port, not a redesign.
- **Whether to do this at all** — strategic direction is settled; this research is about *how*, not *whether*.

## Inspiration

- F294 (compat-half-state removal), F296 (slug-keyed inbox bootstrap), F397 (engine-first lifecycle precedence) — the three most recent attempts to seal folder-as-state leaks. The patterns of where leaks recurred are the strongest input to schema and read-path design.
- `AGENTS.md` § Write-Path Contract — the principle this research operationalises permanently.
- `lib/workflow-core/entity-lifecycle.js` (`isEntityDone`) — current centralised lifecycle precedence; informs how the new model collapses precedence into a single SQL query.
- `lib/dashboard-status-collector.js`, `lib/workflow-read-model.js` — current read-model surface that needs to port.
- Conversation transcript with John on 2026-04-30 capturing the strategic decision and the four-layer architecture (specs → events → DB → view).

## Findings

<!-- To be filled in by the research-do agent. -->

## Recommendation

<!-- To be filled in by the research-do agent. -->

## Output

<!-- Based on findings, create sequenced feature specs via `aigon feature-create "<name>"`. Link the created files below. -->
- [ ] Feature:
