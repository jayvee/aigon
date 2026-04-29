---
complexity: high
---

# Research: dashboard-perf-and-state-architecture

## Context

The recent perf features (F454, F455, F456, F459, F460) cut the dashboard poll cycle from ~5.8 s to ~2.5 s and dropped its cadence from 10 s to 20 s — about a 60 % reduction in per-poll work and a halving of how often the loop is busy. That's a real, measurable win: most clicks now feel instant, where they used to hang multi-second on every spec drawer open and terminal handshake.

But it didn't hit the original sub-200 ms target. The remaining 2.5 s appeared to me to be the cumulative cost of `collectRepoStatus` doing many small synchronous file reads (snapshots, manifests, set indexes, profile config, Caddy routes) across 7 repos × 667 features at this user's scale — i.e. spread across many calls rather than one fat one. **That assessment is itself a research question**, not a settled fact. A senior reviewer might find quick wins I missed: batched stat calls, derived caches keyed by mtime, deferring work to a background tier, dropping work that's not actually consumed by the UI, parallelising independent repo collections, and so on. This research should explicitly try to disprove the "no surgical strike left" claim before accepting it.

This research therefore has two distinct horizons, and the output must address **both**:

1. **Short-term, current-architecture wins.** What high-ROI changes can we still make within the existing polling + filesystem model that we've missed so far? These should be small, low-risk, and shippable as discrete features over the next 1–2 weeks.
2. **Long-term, structural direction.** Where should the architecture go so that we stop patching the polling model — and what near-term decisions preserve the most optionality for that destination?

The framing matters: quick wins shouldn't lock us into the current architecture, and the long-term direction shouldn't block easy short-term wins. Both should compose.

At the same time, the user has flagged several future capabilities that bear on **architecture**, not just perf:

- Push-based / event-driven model instead of polling
- Multiple dashboards (read-only mirrors, per-device views, team views)
- A central server that several dashboards connect to
- Alternative state backends — SQLite, server-side SQL, or even a hosted service like GitHub Issues, Linear, Notion
- These are "nice to have, but architectural decisions made now should make them more possible, not less"

Past research **R10 (filesystem-and-git)** examined a narrow slice of this — specifically whether state moves should still be git commits, and SQLite-as-state as one alternative. **R09 (control-surface-strategy)** covered the UI surface ambitions. Neither answered the broader question: what should Aigon's full transport + server + state stack look like in 12 months, and what near-term decisions preserve maximum optionality for that future?

This research topic asks that broader question from first principles. The user explicitly wants it kept open — researchers should surface options not anticipated here, and frame architectural moves as "doors" (preserve future capability) versus "trapdoors" (foreclose options).

## Questions to Answer

### First principles
- [ ] In 12 months, what personas should Aigon serve? Solo developer / pair / small team / org / cloud-multi-tenant — and where, if anywhere, does Aigon stop being primarily a CLI-and-local-dashboard tool?
- [ ] Is "polling for state every N seconds" the right model at all, or is it an artefact of the original CLI-first design that we're now paying for?
- [ ] What does "fast enough" mean for this dashboard? Define target percentiles for the operations the user cares about: spec drawer open, terminal handshake, kanban refresh, autonomous modal open.
- [ ] Are there architectures used by comparable tools (Linear, Shortcut, GitHub Projects, Trello, Jira, Notion, Plane.so, Taskwarrior) that solve the equivalent at single-user-tier without the costs we're hitting? Which are the closest analogues?

### Short-term wins within the current architecture (high-ROI, ship in 1–2 weeks)
This cluster is **explicitly required to produce a punch list of concrete, low-risk improvements** to the existing polling + filesystem model — independent of any longer-term direction. Treat the 2.5 s poll floor as a hypothesis to disprove, not an accepted fact.
- [ ] Profile `collectRepoStatus` end-to-end at the user's actual scale (7 repos / 667 features / 39 research). Where exactly does the 2.5 s go, ms by ms? Cite measurements, not estimates.
- [ ] Are repos collected sequentially? They're independent — could `Promise.all` across repos parallelise the per-poll work without changing semantics?
- [ ] Could expensive sub-collectors (`applySpecReviewFromSnapshots`, `parseCaddyRoutes`, `getDevServerState`, manifest reads) be cached behind their own mtime gates and recomputed only when their input directory's mtime ticks? F454 partially did this; check what was missed.
- [ ] Are any sub-collectors producing data the UI doesn't actually render? Dead computation per poll is a free win to remove.
- [ ] Can directory listings be batched? `fs.readdir` per stage per repo per poll is dozens of syscalls. Could one `readdir` per repo-spec-root + a stage-from-path filter replace them?
- [ ] Could the dashboard skip the per-feature snapshot read entirely for active features whose snapshot mtime hasn't changed since last poll, rebuilding only what's stale (extending F459's "skip done content" pattern to all features that haven't moved)?
- [ ] Is `pollStatus` doing work that should be on a slower tier? Caddy routes, npm-update check, GitHub remote detection — could any of these run every 5 minutes instead of every 20 seconds without UX impact?
- [ ] Is the response payload to the browser larger than necessary? Could `/api/status` send a delta-since-fingerprint instead of a full snapshot? F454's frontend-side fingerprint already exists; could the server-side equivalent shrink the over-the-wire size?
- [ ] Is the auto-poll cadence right? F460 set it to 20 s active. Is there evidence to drop it further when no state has changed for N cycles? An adaptive cadence based on observed mutation rate?
- [ ] What's the smallest change that drops poll p95 below 500 ms? Below 200 ms? Identify the highest-ROI single change first, then the next, then the next — produce a ranked list.

### Transport: pull vs push
- [ ] Could the dashboard be event-driven — server pushes changes when state mutates — and what would that look like? SSE, WebSockets, append-only event log fan-out, file-watcher-driven invalidation, something else?
- [ ] Where would events originate? The Aigon engine already emits events to `events.jsonl`; can the dashboard subscribe to those instead of re-deriving state every poll?
- [ ] If we keep polling: is the right cadence different for active vs idle data? Could the kanban view stream a differential ("since X, these features changed") instead of a full snapshot?
- [ ] How does each transport degrade — what happens when it fails? Polling has the property that a missed update self-corrects on next tick; push models need explicit reconciliation. Is that an acceptable tradeoff for sub-50 ms perceived latency?

### State backend
- [ ] For each viable state backend — filesystem (today), SQLite, server-side SQL (Postgres / MySQL), embedded KV (LMDB / RocksDB), hosted services (GitHub Issues, Linear API, Notion API) — characterise: query speed at 1k / 10k / 100k features; multi-process safety; history/audit story; conflict semantics; offline behaviour; lock-in; operational footprint.
- [ ] Is there a hybrid where spec markdown stays in the filesystem (human-readable, git-versioned) but **derived state** (kanban positions, snapshots, events, agent statuses) moves to SQLite? What gets cleaner; what gets uglier?
- [ ] Hosted-service backends (GitHub Issues, Linear): do they bring any capability we'd want for free (notifications, mobile, sharing) at acceptable cost in lock-in and offline behaviour?
- [ ] What's the read pattern at scale? If a user has 10k features, can the chosen backend serve a kanban view in <50 ms cold and <5 ms warm?

### Server topology
- [ ] Does the dashboard actually need a server at all? Could it be a static SPA reading state directly from disk / SQLite via a thin local HTTP shim?
- [ ] Could the daemon become much smaller — just an event emitter and command dispatcher — with the dashboard owning more of its own data composition?
- [ ] What's the role of the daemon if state moves out of the filesystem? Is there still one, or does it dissolve?
- [ ] Could the architecture support an optional **central** server that several dashboards connect to (e.g., for a small team), without forcing single-user setups to run one?

### Multi-dashboard / multi-user
- [ ] Three rough scenarios — which are realistic, and which are aspirational? (a) One user, multiple read-only dashboards on different devices/screens; (b) Two collaborators sharing one workspace; (c) A team of 5–20 with shared backlog and per-user views.
- [ ] What sync model fits each: CRDT, last-writer-wins, central-authoritative, op-log replay? Which scenarios are achievable with what we have today vs require new infrastructure?
- [ ] Auth and write boundary — who can mutate what? Today everything is one local user with full trust. What's the minimum viable boundary for a "team" mode?

### Migration & door-preservation
- [ ] Of the architectural moves above, which are "doors" — they preserve all current behaviour AND open new options? And which are "trapdoors" — they commit Aigon to one path and close others?
- [ ] What's the smallest near-term change that buys the most future flexibility? E.g., would introducing an adapter layer between `collectRepoStatus` and the underlying state store let us swap backends later without rewriting consumers?
- [ ] Do F454/F459/F460's recent code shapes constrain or enable any of the directions above? Anything we should refactor while it's still small to keep options open?
- [ ] What's the cost of **doing nothing** — staying on the current architecture indefinitely with incremental tuning? At what scale does it become untenable?

## Scope

### In Scope
- **Short-term, high-ROI wins within the current polling + filesystem architecture** — a ranked, shippable punch list. Required deliverable, independent of any structural direction.
- Architecture options for the dashboard ↔ state ↔ user relationship
- Transport: pull vs push, which mechanisms, what tradeoffs
- State backend options: filesystem, SQLite, server-side SQL, embedded KV, hosted services
- Server topologies: no server, local daemon, central server, hybrid
- Multi-dashboard and multi-user scenarios; sync models
- Migration paths from the current architecture; door-vs-trapdoor analysis
- How recent F454/F459/F460 changes constrain or enable future moves
- Comparable tools at similar scale and what we can learn from them
- A recommended **near-term move** that preserves the most future optionality, plus a **longer-term direction** if it's coherent enough to commit to
- Explicit reasoning about how short-term wins compose with (and don't foreclose) the longer-term direction

### Out of Scope
- Implementing any chosen approach (each direction will be its own feature spec)
- Specific vendor selection unless it's central to a tradeoff
- Slash-command CLI surface changes — separate concern
- Spec file format changes — covered by R10
- Auth and security implementation specifics — covered when a direction is picked
- Any change to the workflow engine's authoritative state model (`isEntityDone`, F397 invariants) — these stay; this research is about how the *dashboard* reads, not how the engine writes

## Inspiration

- **R10 (filesystem-and-git)** — overlaps on state-storage. Build on it; cite where it landed; don't re-derive what it already concluded.
- **R09 (control-surface-strategy)** — UI surface ambitions; useful for understanding what would consume a new architecture.
- Reference tools to study (researchers free to add others): Linear, Shortcut, GitHub Projects, Trello, Jira, Notion API, Taskwarrior, Asana, Plane.so, Cursor's project-management surfaces, Linear's offline architecture.
- Patterns to consider: local-first software (Ink & Switch), event sourcing, CQRS, log-structured merge (Datomic / Datalog), append-only event logs (Kafka / NATS JetStream as conceptual reference even if oversized for our use).

## Findings

<!-- Researchers fill this section. Document discoveries, options evaluated, pros/cons. Per Fleet convention, include a "Divergent Views" subsection if multi-agent and they disagree, then a "Synthesis Decision" that resolves it before recommendations. -->

## Recommendation

<!-- Researchers fill. The recommendation must address BOTH horizons:

(a) **Short-term punch list (current architecture)** — a ranked list of concrete, low-risk, high-ROI changes that ship within 1–2 weeks each. Each item should name the file/function, the expected impact (e.g. "drops poll p95 from 2.5 s to ~800 ms"), and the implementation sketch. Order by ROI, biggest win first.

(b) **Longer-term structural direction** — where the architecture should head so that we stop patching the polling model. State the recommended destination (transport, backend, server topology, sync model) with reasoning. Include the contingencies that would change it. If the picture isn't coherent enough yet to commit, say so plainly and identify what additional research would clarify it.

(c) **Composition** — for each short-term item, briefly note whether it preserves, improves, or constrains optionality for the long-term direction. Quick wins must not foreclose structural moves; structural moves shouldn't block the quick wins. -->

## Output

<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Expect two buckets of features:

  • **Short-term tuning features** — one per high-ROI item from the punch list. Small scope, ship-now.
  • **Structural features** — bigger, longer-term work to move toward the recommended architecture. May include preparatory features (e.g. an adapter layer) that unlock later moves without committing to any single destination.

Link the newly created files below, grouped by bucket. -->

### Short-term tuning features
- [ ] Feature:

### Structural features
- [ ] Feature:
