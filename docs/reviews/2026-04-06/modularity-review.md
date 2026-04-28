# Modularity Review

**Scope**: Aigon — entire codebase (`lib/`, `lib/commands/`, `lib/workflow-core/`, `aigon-cli.js`)
**Date**: 2026-04-06

## Executive Summary

Aigon is an open-source CLI for orchestrating AI coding agents (Claude Code, Gemini, Codex) across feature/research lifecycles, with worktree isolation, tmux session management, and a dashboard server. The core workflow engine (`lib/workflow-core/`) is well-encapsulated and event-sourced, command handlers are cleanly grouped by domain, and the project shows real care about [modularity](https://coupling.dev/posts/core-concepts/modularity/) — the [`ctx` dependency-injection pattern](https://coupling.dev/posts/core-concepts/coupling/), the central action registry, and the read-side adapter for dashboard data are all sound design choices.

The codebase is **healthy overall**, but three integrations are starting to show [unbalanced coupling](https://coupling.dev/posts/core-concepts/balance/) that will become painful as the project's strategic focus shifts toward the commercial Pro tier (`@aigon/pro`): (1) `dashboard-server.js` reads agent state files directly from disk, bypassing the module that owns the schema; (2) `entity.js` mixes shared lifecycle helpers with feature-specific dependency-graph logic — a low-cohesion bundle; and (3) `utils.js` is a 1,910-line facade that aggregates 6 sub-modules alongside 40 inline "orphan" functions, increasing the cognitive cost of change in spec-handling and CLI-parsing code paths. None of these are urgent today, but each will compound as Pro features add new read paths, new state fields, and new dashboard integration points.

## Coupling Overview

| Integration | [Strength](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) | [Distance](https://coupling.dev/posts/dimensions-of-coupling/distance/) | [Volatility](https://coupling.dev/posts/dimensions-of-coupling/volatility/) | [Balanced?](https://coupling.dev/posts/core-concepts/balance/) |
| ----------- | ----------- | ----------- | ----------- | ----------- |
| `commands/*` → `workflow-core/` engine | [Functional](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (engine API) | Low (same process, neighbor module) | High (core domain — lifecycle is the product) | ✅ Balanced — high strength is justified by the engine being the single authority |
| `dashboard-server.js` → `.aigon/state/*.json` (direct fs reads) | [Intrusive](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (knows file naming, JSON schema, location) | Low (same process) | High (state schema evolves with Pro insights, liveness signals) | ❌ **Unbalanced** — see Issue 1 |
| `commands/feature.js` ↔ `entity.js` (dependency-graph functions) | [Functional](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (7 graph helpers used only by features) | Low (same lib/) | Moderate (graph semantics will evolve with insights) | ❌ **Low cohesion** — see Issue 2 |
| All commands → `lib/utils.js` (re-export hub + 40 orphan helpers) | [Model](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (consumers depend on aggregated symbol surface) | Low (same lib/) | Mixed — spec/CLI helpers are volatile, re-exports are stable | ❌ **Low cohesion** — see Issue 3 |
| `dashboard-server.js` → CLI subprocess (`spawnSync('aigon …')`) for mutations | [Contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (CLI args as published interface) | High (separate process) | High (commands evolve frequently) | ✅ Balanced — intentional decoupling, dashboard never mutates engine state in-process |
| `lib/pro.js` → `@aigon/pro` (commercial tier) | [Contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (lazy require + `isProAvailable()` gate) | High (separate npm package, separate repo) | High (strategic focus — Pro tier is next priority) | ⚠️ Balanced today, fragile tomorrow — see Issue 4 |
| `commands/feature.js` → `lib/feature-close.js` (callback injection for `persistAndRunEffects`) | [Functional](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) with circular-dep workaround | Low (sibling files) | Moderate | ⚠️ Minor — workaround signals an awkward seam |
| `workflow-core/` internal modules (engine, projector, machine, lock) | [Functional](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) | Low (same directory, single bounded context) | High (core) | ✅ Balanced — cohesive bounded context, internal coupling is appropriate |
| `lib/git.js`, `lib/terminal-adapters.js`, `lib/security.js` → consumers | [Contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) (narrow function APIs) | Low | Low ([generic subdomain](https://coupling.dev/posts/dimensions-of-coupling/volatility/)) | ✅ Balanced — generic helpers, low volatility absorbs any imbalance |

---

<div class="issue">

## Issue 1: Dashboard server reads agent state files directly, bypassing the schema owner

**Integration**: `lib/dashboard-server.js` → `.aigon/state/feature-{id}-{agent}.json` (and `docs/specs/features/logs/`, `docs/specs/features/{stage}/`)
**Severity**: <span class="severity severity-significant">Significant</span>

### Knowledge Leakage

`lib/agent-status.js` is the declared owner of the per-agent state file format — it exports `readAgentStatus`, `writeAgentStatus`, `agentStatusPath`, and uses an atomic write pattern to keep concurrent reads safe. Yet `dashboard-server.js` performs 67 direct `fs.readFileSync` / `fs.readdirSync` calls against `.aigon/state/`, log directories, and spec folders. To do this it has to know:

- The file naming convention (`feature-{id}-{agent}.json`, `heartbeat-feature-{id}-{agent}`)
- The JSON schema of each agent status file (it destructures `lastSubmittedAt`, `status`, `tokens`, etc.)
- The storage location relative to `repoPath`
- The discovery glob (which prefixes count, how to enumerate by entity ID)

This is [intrusive coupling](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/): the dashboard treats the state directory as a private implementation detail of the engine, but reads it as if the schema were a [published contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/). The same pattern applies to log files (`docs/specs/features/logs/feature-{id}-{agent}-*-log.md`) and evaluation files — the dashboard knows the naming conventions of artifacts that other modules produce.

### Complexity Impact

Because dashboard-server.js knows file-format details, every change to how agent status is recorded requires touching two unrelated modules. The CLAUDE.md rule "Restart after backend edits" exists partly because these schema dependencies are implicit — there's no compile-time check that the dashboard is in sync with the writer. When you add a new field to agent status, the dashboard silently keeps reading the old shape until you remember to update it.

[Cognitive load](https://coupling.dev/posts/core-concepts/complexity/) is also higher than it needs to be: a developer reading `dashboard-server.js` has to mentally track which directories it pokes at, which file formats it parses inline, and which it delegates. The 3,111-line module has 67 fs operations interleaved with HTTP route handlers, making it hard to see where the read boundaries are.

### Cascading Changes

Concrete scenarios where this will hurt as Pro grows:

- **Pro insights need a richer agent status schema** (e.g., `lastInsightTimestamp`, `confidenceScore`, `attentionFlags`). Adding these fields to `agent-status.js` is one line; updating every `fs.readFileSync` parser site in dashboard-server.js is many.
- **Liveness/heartbeat representation changes** (already imminent — heartbeat is currently a touch-file, but a JSON sidecar with metadata would be more useful). Two modules need to change in lockstep.
- **Multi-process safety**: `agent-status.js` uses temp-file + rename for atomic writes. The dashboard's direct reads can race with concurrent writers; if it ever uses `JSON.parse` on a partial write, it crashes the route handler.
- **Schema migration**: when an old field is renamed, every direct reader needs to be updated; a centralized accessor could handle the migration in one place.

### Recommended Improvement

Introduce a thin **read-side facade** that owns all "what does the engine know about this entity?" queries. The pieces are mostly in place:

1. Move every direct `.aigon/state/` and log-file read out of `dashboard-server.js` into either `lib/agent-status.js` (status reads) or `lib/dashboard-status-collector.js` (already the declared aggregator). Expose `getAgentStatusForDashboard(repoPath, entityId)` and `getEntityArtifacts(repoPath, entityId)` and have the route handlers call those.
2. Replace the 67 `fs.*` calls in `dashboard-server.js` with calls into `agent-status.js`, `feature-spec-resolver.js`, and `dashboard-status-collector.js`. The destination modules already exist; this is a relocation, not new code.
3. Once the moves are done, add a comment marker in `dashboard-server.js` ("no direct fs reads of engine state — use the collector") to keep the boundary visible.

**Trade-off**: A small amount of indirection and a few new functions in `agent-status.js` / `dashboard-status-collector.js`. The cost is one extra hop per read; the benefit is that schema changes touch one file instead of two, and the dashboard's role becomes "HTTP transport over the read model" rather than "HTTP transport that also knows where the engine puts its files." This aligns with the CLAUDE.md rule "Dashboard must be read-only" — currently the dashboard is read-only with respect to *mutations*, but it still reaches into engine internals for *reads*. Closing that gap makes the rule actually enforceable.

</div>

<div class="issue">

## Issue 2: `entity.js` bundles shared lifecycle helpers with feature-only dependency-graph logic

**Integration**: `lib/entity.js` ↔ `lib/commands/feature.js` (and `lib/dashboard-server.js`, `lib/feature-close.js`)
**Severity**: <span class="severity severity-significant">Significant</span>

### Knowledge Leakage

`lib/entity.js` is documented as "the unified pipeline for features and research" — and ~30% of it is exactly that: `entityCreate`, `entityPrioritise`, `entitySubmit`, `entityCloseFinalize`, `createFleetSessions`. These are genuinely shared between `commands/feature.js` and `commands/research.js`, and parameterized by `FEATURE_DEF` / `RESEARCH_DEF`. That part is well-designed.

The other ~70% (about 600 of the 869 lines) is feature-specific dependency-graph code: `buildFeatureIndex`, `resolveDepRef`, `buildDependencyGraph`, `detectCycle`, `rewriteDependsOn`, `buildFeatureDependencySvg`, `refreshFeatureDependencyGraphs`. None of these are called from `commands/research.js`. Their consumers are exclusively `commands/feature.js`, `feature-close.js`, and `dashboard-server.js`. This is [low cohesion](https://coupling.dev/posts/core-concepts/balance/): unrelated concerns sharing a module by accident of history rather than by design.

### Complexity Impact

Three concrete consequences:

1. **Misleading API surface.** A new contributor reading `entity.js` exports sees `buildFeatureDependencySvg` next to `entityCreate` and reasonably assumes both are part of a shared abstraction. When they later realize the SVG builder is feature-only, they have to revise their mental model. This is exactly the [cognitive overload](https://coupling.dev/posts/core-concepts/complexity/) the [Balanced Coupling](https://coupling.dev/posts/core-concepts/balance/) model warns about.
2. **Test surface confusion.** Changes to dependency-graph rendering trigger reviews of "the shared entity module," which raises the perceived blast radius unnecessarily. Reviewers think they need to consider research impact when they don't.
3. **The 869-line file mixes two paradigms.** Lifecycle functions take `(def, name, ctx)` and are polymorphic across entity types. Graph functions take `(paths, utils, featureIndex)` and are feature-specific. The mental gear-shifting between them inflates the time it takes to navigate the file.

### Cascading Changes

Concrete scenarios:

- **Pro insights will want richer dependency graphs** — predictive blockers, ML-suggested ordering, time-weighted visualizations. All of that change pressure lands on `entity.js`, but the volatility belongs to feature-only code, not the shared lifecycle code.
- **A future research dependency model** (e.g., research-topic chains) would have to either reuse the feature graph functions (forcing them to become polymorphic, expanding the "shared" surface further) or duplicate them. Today there's no clear path because graph code lives in a module that already claims to be "shared."
- **Extracting feature-specific code becomes harder over time** as more files import from `entity.js` for the graph helpers. `dashboard-server.js` already destructures three of them at line 49.

### Recommended Improvement

Split `entity.js` along the cohesion line that already exists in the code:

1. Keep `lib/entity.js` for genuinely shared lifecycle functions: `FEATURE_DEF`, `RESEARCH_DEF`, `getEntityDef`, `entityCreate`, `entityPrioritise`, `entitySubmit`, `entityCloseFinalize`, `createFleetSessions`. Target ~250 lines.
2. Create `lib/feature-dependencies.js` for the graph code: `buildFeatureIndex`, `resolveDepRef`, `buildDependencyGraph`, `detectCycle`, `rewriteDependsOn`, `buildFeatureDependencySvg`, `refreshFeatureDependencyGraphs`. Target ~600 lines.
3. Update the four importers (`commands/feature.js`, `feature-close.js`, `dashboard-server.js`, `entity.js` itself for the prioritise flow that uses `buildDependencyGraph` internally).

**Trade-off**: Three to four import-statement changes and one new file. The cost is trivially small; the benefit is that the boundary between "shared lifecycle" and "feature-specific graph logic" becomes visible in the file structure, the cognitive load of `entity.js` drops by ~70%, and Pro-driven changes to the graph logic stop touching a file labeled "shared." This is a [low-cohesion fix](https://coupling.dev/posts/core-concepts/balance/) — the code itself doesn't need to change, just its location.

</div>

<div class="issue">

## Issue 3: `lib/utils.js` mixes a re-export facade with 40 inline orphan helpers

**Integration**: All commands → `lib/utils.js` (17 direct consumers, 212+ exported symbols)
**Severity**: <span class="severity severity-significant">Significant</span>

### Knowledge Leakage

`lib/utils.js` plays three structurally different roles in the same file:

1. **Re-export aggregator** for 6 sub-modules (`config`, `proxy`, `templates`, `worktree`, `dashboard-server`, `git`, `state-queries`) — about 177 of its 212 exports come through here.
2. **Inline orphan helper module** for 40 functions that are *only* defined in `utils.js`: spec CRUD (`createSpecFile`, `findFile`, `moveFile`, `modifySpecFile`, `getNextId`), CLI/YAML parsing (`parseCliOptions`, `parseFrontMatter`, `serializeYamlScalar`, `slugify`), hooks (`parseHooksFile`, `executeHook`), analytics (`collectAnalyticsData`, `buildCompletionSeries`), version checking (`getAigonVersion`, `compareVersions`), and feedback constants.
3. **De-facto shared namespace** that consumers like `commands/feature.js` (73 symbols), `commands/infra.js` (72), `dashboard-server.js` (68), and `commands/setup.js` (52) treat as "the standard library."

The leaked knowledge isn't a single schema or rule — it's the *organizing principle*. Consumers can't tell from an import whether `findFile` is implemented in utils.js or re-exported from somewhere else, whether `loadProjectConfig` will hit the disk or the cache, whether `parseFrontMatter` is the same parser used by `feedback.js` (it is, indirectly). This is [model coupling](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/): the consumers depend on a derived, aggregated view of multiple lower-level modules.

### Complexity Impact

The most concrete cost shows up when reading or modifying spec-handling code. `commands/feature.js` calls `u.findFile`, `u.createSpecFile`, `u.moveFile`, `u.parseFrontMatter`, `u.modifySpecFile` — every spec operation routes through `utils.js`. To understand any of these you have to first locate them in a 1,910-line file, then mentally separate them from the unrelated re-exports surrounding them. The "distance to definition" is artificially long.

There's also a [false-cohesion trap](https://coupling.dev/posts/core-concepts/balance/): because everything imports from `utils.js`, it *looks* like there's a single shared surface, but the underlying code lives in 7+ different files plus 40 orphans. When something feels wrong with `parseFrontMatter`, the search starts in the wrong place.

### Cascading Changes

Concrete scenarios:

- **Pro insights need new analytics fields.** `collectAnalyticsData` lives in `utils.js`. Today, changing it ripples to `setup.js`, `dashboard-server.js`, and `dashboard.js` — three consumers that share no other concerns. If analytics had its own module, the change blast radius would be bounded.
- **Spec format evolves** (e.g., new YAML front-matter fields for Pro features). `parseFrontMatter` is consumed by 7 files. Today they all import via `utils.js`; if a future change splits front-matter handling into structured types, every consumer's import path has to be revisited.
- **A new contributor wants to understand "how does aigon manage spec files"** and ends up reading 1,910 lines of utils.js because the spec functions are scattered between feedback constants, version-check functions, and re-exports from 6 unrelated modules.
- **Backward-compat shims grow.** As sub-modules evolve, `utils.js` becomes the place to add backward-compatibility shims — and it already has some. Each shim is invisible coupling that future readers have to discover.

### Recommended Improvement

Don't try to dissolve `utils.js` in one move. Instead, extract the orphans into focused modules over time, then thin `utils.js` into a pure facade for [contract coupling](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/):

1. **`lib/specs.js`** — `createSpecFile`, `findFile`, `findUnprioritizedFile`, `moveFile`, `modifySpecFile`, `getNextId`, `printSpecInfo`, `printError`, `printNextSteps`. This is the highest-value extraction: spec handling is volatile (Pro will add fields), and the consumers (`feature.js`, `validation.js`, `commands/feedback.js`) are the most coupling-sensitive.
2. **`lib/yaml-parsing.js`** — `parseFrontMatter`, `serializeYamlScalar`, `parseYamlScalar`, `splitInlineYamlArray`, `stripInlineYamlComment`, `parseCliOptions`, `getOptionValue`, `getOptionValues`, `parseNumericArray`, `slugify`, `escapeRegex`, `extractMarkdownSection`. These are pure functions with low coupling between themselves; perfect candidates for a small, stable module.
3. **`lib/analytics.js`** — `collectAnalyticsData`, `buildCompletionSeries`, `buildWeeklyAutonomyTrend`. Three consumers, all in the dashboard/setup/insights area. Pro will want to add to this module; giving it a clear home now means Pro's analytics extensions can extend a real boundary instead of growing utils.js further.
4. **Leave `utils.js` as a re-export facade only.** Keep the 17 existing consumers working by re-exporting from the new modules — no breaking changes. New code can import from the focused modules directly.

**Trade-off**: Three new files and ~3 days of focused work to relocate functions and update tests. The cost is real but bounded; the benefit compounds because every future Pro feature touching spec or analytics code now has a sensible home, and the 1,910-line file stops growing. The [contract coupling](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) of "import from utils" stays available for backward compatibility, while new code can target [smaller, more cohesive boundaries](https://coupling.dev/posts/core-concepts/modularity/).

</div>

<div class="issue">

## Issue 4: `lib/pro.js` integration is balanced today, but the strategic direction will stress it

**Integration**: `lib/pro.js` → `@aigon/pro` (commercial tier) → consumed by `dashboard-server.js`, `commands/misc.js`, `dashboard-status-collector.js`
**Severity**: <span class="severity severity-minor">Minor (anticipatory)</span>

### Knowledge Leakage

The current Pro integration is exemplary [contract coupling](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/): a 24-line `lib/pro.js` that lazy-requires `@aigon/pro`, exposes `isProAvailable()` and `getPro()`, and lets every consumer gracefully degrade when Pro isn't installed. Today there's exactly one Pro-gated route in the dashboard (`GET /api/insights`) plus a couple of references in `commands/misc.js` and `dashboard-status-collector.js`. The `forcePro` config override even lets you simulate the free tier when Pro is installed, which is a great testability lever.

The risk is not in the current code — it's in the trajectory. The user has identified the Pro tier as the next strategic priority. Pro features (insights, amplification dashboard, AI coaching) will need to:

- Read more data from the workflow engine (snapshot fields, event log, telemetry)
- Hook into more dashboard routes (`/api/insights/*`, `/api/coaching/*`, `/api/amplification/*`)
- Subscribe to lifecycle events (when a feature closes, run insights generation)
- Possibly add new entity types or new lifecycle stages

If each new Pro hook is added the same way as today — `if (!isProAvailable()) return; getPro().something(...)` — the `getPro()` calls will scatter across the codebase, and the [volatility](https://coupling.dev/posts/dimensions-of-coupling/volatility/) of the Pro API surface will start cascading through unrelated modules. That's the moment the integration becomes [unbalanced](https://coupling.dev/posts/core-concepts/balance/).

### Complexity Impact

Today the Pro surface is 4 call sites; that's well within working-memory limits. As it grows past ~10–15 call sites, the cognitive cost of "where does Pro touch this codebase?" starts to exceed the [4±1 working-memory budget](https://coupling.dev/posts/core-concepts/complexity/). A change to the Pro API would force a hunt across the open-source repo to find all the gates. This is solvable now, painful later.

### Cascading Changes

Concrete scenarios that will arrive as Pro grows:

- **A Pro insights feature wants to read closed-feature telemetry on every close.** Naively, that means a `getPro()?.insights.onFeatureClosed(...)` call inside `feature-close.js`. Now `feature-close.js` knows about Pro, and any change to the Pro hook signature touches both repos.
- **A Pro coaching feature wants to inject suggestions into the dashboard's spec view.** Naively, that means a Pro check in the `/api/spec` route. Now the dashboard read paths have conditional logic based on tier.
- **A Pro feature wants to schedule background work.** Where does the scheduler hook live? If it's in `lib/pro.js`, that file balloons; if it's in the consumer, the gating logic gets duplicated.

### Recommended Improvement

Introduce a **single Pro extension point** before the proliferation begins. A few concrete shapes that would work:

1. **Event-bus pattern**: have the engine emit lifecycle events (`feature.closed`, `research.submitted`) onto an in-process emitter. `lib/pro.js` (or a thin `lib/pro-bridge.js`) subscribes if Pro is installed; the open-source code never references Pro directly. This is the cleanest [contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) — Pro becomes a subscriber, not a caller.
2. **Plugin route registration**: let `@aigon/pro` register its own routes on the dashboard server at startup, instead of having `dashboard-server.js` know about insights specifically. The dashboard exposes `app.registerProRoutes(router)` once; Pro fills in `/api/insights/*`, `/api/coaching/*`, etc. without the open-source repo needing to know what Pro will add next.
3. **Anti-corruption layer for reads**: if Pro needs richer reads, those read functions live in `dashboard-status-collector.js` (which already aggregates engine data) and Pro consumes them. Pro never reaches into `.aigon/state/` directly.

The work is small *now* (one Pro hook, one consumer); it gets harder every time a new Pro feature ships against the current pattern. Doing this *before* the next Pro feature lands costs a few hours; doing it after costs a refactor across both repos.

**Trade-off**: A small amount of upfront design (event names, registration API). The benefit is that Pro's [volatility](https://coupling.dev/posts/dimensions-of-coupling/volatility/) — which is high by definition because it's the active commercial focus — stays bounded behind a single seam, and the open-source codebase doesn't accumulate `getPro()?.…` calls in unrelated files. This is a textbook case for [reducing strength via a published contract](https://coupling.dev/posts/dimensions-of-coupling/integration-strength/) before the strength starts to climb on its own.

</div>

---

## Notes on Other Integrations Considered

A few patterns surfaced during analysis but were deliberately *not* flagged as issues:

- **`dashboard-server.js` mutates state via CLI subprocess (`spawnSync('aigon …')`)**, not direct engine calls. This looks heavy-handed but is a deliberate isolation boundary — the dashboard genuinely never holds engine locks, which is the right call for a read-mostly HTTP server. The latency cost is justified by the reliability benefit. ✅ Keep as is.
- **`workflow-core/` internal coupling** (engine ↔ projector ↔ machine ↔ event-store ↔ lock) is high, but these are all parts of the same [bounded context](https://coupling.dev/posts/related-topics/domain-driven-design/) and the [distance is minimal](https://coupling.dev/posts/dimensions-of-coupling/distance/). High strength inside a cohesive module is exactly what you want. ✅ Healthy.
- **`feature-close.js` receives `persistAndRunEffects` as a callback** to avoid a circular require with `commands/feature.js`. This is a code smell — it suggests the module boundaries aren't quite right around the close flow — but the workaround is contained, the module is well-phased, and fixing it would touch both files for marginal benefit. ⚠️ Note for future cleanup, not a current issue.
- **`feedback.js` uses folder-based state transitions** instead of the workflow-core engine. This is a second state-management paradigm in the same codebase, which is worth knowing, but feedback is a [supporting subdomain](https://coupling.dev/posts/dimensions-of-coupling/volatility/) with low [volatility](https://coupling.dev/posts/dimensions-of-coupling/volatility/) — promoting it to the engine would be effort without payoff. ✅ Acceptable as is.
- **`commands/feature.js` is 3,251 lines with 15 handlers.** The size is striking, but the user reports no pain working with it, the handlers cluster naturally by lifecycle phase, and several are thin delegators (`feature-validate`, `feature-review`, `feature-now`). Splitting it would be aesthetic, not load-bearing. ✅ Acceptable; revisit only if specific handlers start changing together unexpectedly.

## Summary of Recommendations

1. **Move `dashboard-server.js`'s direct fs reads** of `.aigon/state/` and log files into `agent-status.js` and `dashboard-status-collector.js`. (Issue 1)
2. **Extract the dependency-graph functions** out of `entity.js` into a new `lib/feature-dependencies.js`. (Issue 2)
3. **Extract spec CRUD, YAML parsing, and analytics** out of `utils.js` into `lib/specs.js`, `lib/yaml-parsing.js`, and `lib/analytics.js`. Keep `utils.js` as a re-export facade for backward compatibility. (Issue 3)
4. **Define a single Pro extension point** (event bus or plugin route registration) before the next Pro feature ships. (Issue 4)

None of these are urgent. All four become easier to do *now* than they will be after the next round of Pro features lands.

---

_This analysis was performed using the [Balanced Coupling](https://coupling.dev) model by [Vlad Khononov](https://vladikk.com)._
