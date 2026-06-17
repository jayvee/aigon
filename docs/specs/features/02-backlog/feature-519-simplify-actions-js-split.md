---
complexity: high
set: architecture-simplify-2026-05
depends_on:
  - 517
  - 555
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T00:34:53.274Z", actor: "cli/feature-prioritise" }
---

# Feature: simplify-actions-js-split

## Summary

`templates/dashboard/js/actions.js` is **3,482 lines in a single file with 91 functions**. It remains the largest dashboard action surface; the next-largest dashboard files are now `settings.js` and `pipeline.js` at roughly 1.9k LOC each. `actions.js` mixes the per-card action button renderer (`renderActionButtons`), per-action click handler (`handleFeatureAction`), set action handler (`handleSetAction`), inline modal definitions for nearly every action (start / review / eval / close-with-cherry-pick / spec-review / autonomous / schedule / nudge / etc.), the shared triplet-picker integration, and `fetch()` wrappers. Across the dashboard JS there are many `innerHTML` writes and `fetch()` calls, most concentrated here. This is the highest-risk item in the architecture-simplify set because it touches the most user-visible code. Schedule it last and lean hard on Playwright coverage.

Important current-state correction: the dashboard is loaded from `templates/dashboard/index.html` as ordered classic scripts, not as a full ESM graph. `pipeline.js` and `monitor.js` call `renderActionButtons(...)`, `handleFeatureAction(...)`, `handleSetAction(...)`, and `showNudgeModal(...)` as globals. This feature must preserve those global entry points through a thin compatibility shell in `actions.js` while lazy-loading the action implementations behind it. Dynamic-imported action modules are ESM-scoped, so they must receive an explicit context object and/or import ESM helpers; they must not assume classic-script lexical helpers are available by unqualified name.

This feature should run after F517 and F555. F517 stabilises the dashboard entity read model that action buttons consume. F555 stabilises the AgentSession -> Workflow signal surface that action flows such as start, nudge, close, and autonomous orchestration depend on.

## User Stories

- [ ] As a customer loading the dashboard, the JS payload is smaller because per-action modal code is lazy-loaded on first click.
- [ ] As an agent tweaking the "feature-close" modal, I open `templates/dashboard/js/actions/close.js` (~150 LOC) instead of `actions.js` (~3,500 LOC).
- [ ] As a security-conscious reviewer, the per-action split forces a per-action audit of `innerHTML` usage and creates a natural seam to standardise on a small `el()` helper.

## Acceptance Criteria

- [ ] `templates/dashboard/js/actions.js` shrinks to <=700 LOC. Remaining content is limited to the global compatibility API, card-level button rendering, dispatcher functions, dynamic-import cache, module error handling, and the context builder used to call action modules.
- [ ] Existing global call sites continue to work: `renderActionButtons`, `handleFeatureAction`, `handleSetAction`, and `showNudgeModal` remain callable by `pipeline.js` and `monitor.js` until those files are deliberately migrated in a later feature.
- [ ] Each modal-bearing or high-complexity action lives in `templates/dashboard/js/actions/<action>.js`: at minimum `start.js`, `review.js`, `eval.js`, `close.js`, `spec-review.js`, `autonomous.js`, `set-autonomous.js`, `schedule-kickoff.js`, `nudge.js`, `pause.js`, `delete.js`, and `reset.js`.
- [ ] Action modules export a stable contract: `open(ctx)` and optional `close(ctx)`. `ctx` includes `{ va, feature, setCard, repoPath, btn, pipelineType, entityType, helpers, api }` as applicable. Modules must use `ctx.helpers` or explicit ESM imports for shared helpers; they must not reach into hidden classic-script globals.
- [ ] `actions.js` lazy-loads action modules on first click using dynamic `import()` and caches successful imports. Failed imports show a user-visible error, restore the initiating button state, and do not leave modal backdrops or disabled controls behind.
- [ ] Server-owned `validActions` remains the source of truth for action eligibility, labels, button classes, and CTA visibility. This feature only changes frontend decomposition; it must not move workflow eligibility logic into action modules.
- [ ] All `innerHTML` writes across `templates/dashboard/js/` are reviewed during the migration. Any write that interpolates user-controlled content uses `escHtml` or a DOM construction helper. Document the pass in the implementation log.
- [ ] `npm run test:browser` passes. The dashboard-e2e suite is extended with at least one new test that exercises lazy-load, for example asserting the close modal module is fetched only after a Close action is clicked.
- [ ] Bundle-size budget: measured initial JS payload for `/` (excluding xterm vendor) drops by >=30%, or the implementation log explains why the threshold cannot be reached after the modal code has been lazy-loaded.
- [ ] If this introduces a new `templates/dashboard/js/actions/` module layout or dashboard action contract, update `AGENTS.md` and `docs/architecture.md` in the same change.

## Validation

```bash
npm run test:browser
# Size checks
wc -l templates/dashboard/js/actions.js                # expect: <= 700
wc -l templates/dashboard/js/actions/*.js | tail -1    # report total
node --check templates/dashboard/js/actions.js
rg -n "innerHTML\\s*=" templates/dashboard/js          # review and document unsafe-looking writes
# Lazy-load verification:
# Load /, observe initial JS; click "Close" on a feature; assert actions/close.js is fetched on click
```

## Technical Approach

- **Preserve the public surface first.** Treat `actions.js` as a compatibility adapter for existing classic-script consumers. Do not require a broad `pipeline.js` / `monitor.js` rewrite to complete this feature.
- **Create the action module contract.** Add `templates/dashboard/js/actions/` modules with `open(ctx)` and optional `close(ctx)`. `actions.js` builds `ctx` and invokes the module. Shared code that only action modules need can live in `actions/shared.js`; shared code needed by both the classic adapter and modules should be passed through `ctx.helpers`.
- **Split by action before changing behavior.** Move one action at a time, preserve request payloads and DOM output, and keep Playwright green after each tranche. Start with lower-risk modals (`nudge`, `pause`, `delete`, `reset`) before moving high-traffic launch/close/autonomous flows.
- **Lazy-load after the split is stable.** Once modules are isolated, switch the dispatcher to `import()` with a small import cache and deterministic error handling.
- **No backend or workflow rule changes.** Keep command endpoints, API payloads, and `validActions` semantics intact. This feature is a frontend decomposition only.
- **Risk control.** Capture Playwright screenshots or traces for every migrated modal before and after. Pay particular attention to start/autonomous triplet selection, close-with-agent, set autonomous actions, and nudge.

## Dependencies

- F517 (`simplify-unified-entity-view`) should land first so the frontend action surface consumes a stable entity read payload.
- F555 (`agent-session-workflow-signal-bridge`) should land first so action modules do not split around a signal path that is still being redesigned.
- Schedule this last in `architecture-simplify-2026-05` because frontend action behavior is user-visible and needs the quietest possible baseline.

## Out of Scope

- Replacing `innerHTML` with DOM construction wholesale — too risky for one feature. Limited to auditing existing writes during the per-action split.
- Adopting a frontend framework (React, Lit, etc.). The split keeps vanilla JS.
- Changing modal visual design. Use `Skill(frontend-design)` if any visual change is unavoidable.
- Converting the entire dashboard to ESM. This feature may use ESM for dynamically imported action modules, but the existing classic-script dashboard shell remains in place.
- Migrating `pipeline.js` or `monitor.js` to import action APIs directly. They continue using the global compatibility functions.

## Related

- Set: architecture-simplify-2026-05
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 519" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-519" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-519)"/><path d="M 544 174 C 584 174, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-519)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-519)"/><path d="M 244 174 C 284 174, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-519)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#515</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify centralise paths…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#517</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify unified entity v…</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#519</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">simplify actions js split</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="24" y="132" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="156" font-size="14" font-weight="700" fill="#0f172a">#554</text><text x="36" y="178" font-size="13" font-weight="500" fill="#1f2937">agent session tmux host a…</text><text x="36" y="198" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="132" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="336" y="156" font-size="14" font-weight="700" fill="#0f172a">#555</text><text x="336" y="178" font-size="13" font-weight="500" fill="#1f2937">agent session workflow si…</text><text x="336" y="198" font-size="12" fill="#475569">in-progress</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
