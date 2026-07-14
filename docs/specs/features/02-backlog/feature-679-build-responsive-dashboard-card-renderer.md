---
aigon_id: F679
complexity: very-high
set: dashboard-ui-rollout
depends_on:
  [678]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-14T22:10:07.327Z", actor: "cli/feature-prioritise" }
---

# Feature: Build responsive dashboard card renderer

## Summary

Build the production feature, research, and feature-set card renderer from the interaction contracts adopted in F678. Preserve all current commands and action dispatch paths while implementing the approved gallery information hierarchy, session inspection behavior, and responsive card primitives. Ship it behind a documented dashboard preview switch that defaults off so it can be exercised against real repositories before becoming the only renderer.

## User Stories

- [ ] As an operator, I can understand an entity's identity, current activity, blockers, agent ownership, and next decisions without duplicated or machine-oriented labels.
- [ ] As an operator, I can use every action permitted by the current workflow, including close, review, revise, cancel, stop, resume, recover, evaluate, and overflow actions.
- [ ] As an operator, I can Peek at any inspectable live or retained agent session directly from the session or stage that owns it.
- [ ] As a developer, I can render all entity cards through shared contract-driven primitives rather than separate state-specific HTML branches.
- [ ] As a maintainer, I can enable or disable the candidate renderer without changing workflow state or losing dashboard functionality.

## Acceptance Criteria

- [ ] A shared production renderer consumes `uiContract` for feature, research, and feature-set cards; it does not derive actions or lifecycle meaning from filenames, lane names, agent count, status strings, or CSS classes.
- [ ] The preview renderer is controlled by a documented repo or global dashboard setting, defaults off, and can be changed without migrating workflow data. The setting lives in the existing dashboard settings mechanism (`lib/dashboard-settings.js` and the dashboard Settings surface), not a new config file or sidecar.
- [ ] Preview and legacy cards dispatch through the same validated `/api/action` and session Peek boundaries. The preview renderer introduces no alternate command construction.
- [ ] Entity titles appear once. Cards do not repeat a machine slug as a second title or add redundant labels such as `FEATURE`.
- [ ] Small, tightly tracked uppercase phase labels such as `NOW`, `NEXT`, and `COMPLETE` are not used. State and action language is plain, specific, and sentence case.
- [ ] Feature and research cards use the same structural primitives while retaining entity-specific actions and vocabulary.
- [ ] Feature-set cards show the set title once, member progress, and the full current-member contract. Machine slugs are available only where operationally necessary, such as details or copyable identifiers.
- [ ] Autonomous controllers are visually higher-level than their stages. Worker sessions are shown inside their owning stage and are not duplicated in a separate activity list.
- [ ] Autonomous stage rows use stable columns so state marker, stage name, agent, status, and Peek controls align across Implement, Review, Revise, and Close.
- [ ] Every inspectable running, completed, stopped, lost, and failed agent session exposes Peek. Completed sessions open retained output rather than being treated as non-interactive history.
- [ ] Primary, secondary, destructive, and overflow actions are rendered from contract metadata with consistent priority and confirmation behavior.
- [ ] Cards have stable responsive constraints: compact and expanded variants fit their parent, long names wrap, controls do not resize the layout, and no content overlaps at desktop or 390px mobile widths.
- [ ] Keyboard focus order follows visual order; icon-only controls have accessible names and tooltips; action menus and Peek are operable without a pointer.
- [ ] The living gallery can render the production card implementation, or a deliberate adapter around it, so gallery and production card behavior cannot drift silently.
- [ ] Existing action regression tests cover the preview renderer for representative feature, research, set, Fleet, autonomous, review, recovery, failure, and completed-session scenarios. These tests enable the preview setting explicitly; the default-off setting must not leave the candidate renderer exercised only by the gallery.
- [ ] Renderer modules are ES modules under `templates/dashboard/js/`; new stylesheets live in `templates/dashboard/styles/` and are listed in `styles/manifest.json`; no CDN assets (vendor under `js/vendor/`).

## Technical Approach

1. Introduce small renderer modules for identity, activity, blocker, agent/session, autonomous plan, action bar, and overflow menu rather than extending the existing monolithic Pipeline card builder.
2. Treat the versioned contract as the only semantic input. Browser state may hold view concerns such as expansion, selected menu, or density, but not workflow policy.
3. Reuse the existing action execution, confirmation, detail drawer, and session Peek APIs. Centralize action-to-control rendering so the same action ID cannot acquire different behavior across cards.
4. Add a preview setting at the dashboard shell boundary. Render legacy and candidate implementations from the same status payload; do not fork the collector.
5. Move approved visual tokens from the gallery into production-scoped styles with explicit compact/expanded variants. Keep gallery assets isolated except for intentionally shared renderer code.
6. Add DOM and screenshot fixtures for the complete gallery scenario matrix, including long titles, multiple agents, empty optional sections, failures, completed sessions, autonomous review/revision, and nested set members.

## Validation

```bash
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
npm run test:browser:smoke
npm run test:iterate
```

## Dependencies

- `depends_on: 678` - production collectors must emit complete contracts before browser rendering is adopted.

## Out of Scope

- Changing the overall Pipeline column layout or drag-and-drop behavior.
- Replacing the Monitor composition.
- Making the preview renderer the default or deleting the legacy card builder.
- Changing lifecycle or autonomous workflow policy.

## Open Questions

- None. The preview switch is intentionally temporary and is removed only by F682 after production validation.

## Related

- Prior work: F677 approved state gallery and card design.
- Set member: F680 applies this renderer to the responsive Pipeline.
- Living reference: Cards view in `npm run gallery`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="132" viewBox="0 0 1168 132" role="img" aria-label="Feature dependency graph for feature 679" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-679" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-679)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-679)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-679)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#679</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">build responsive dashboar…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#680</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">roll out responsive dashb…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#681</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">replace dashboard monitor…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#682</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">complete dashboard ui cut…</text><text x="936" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
