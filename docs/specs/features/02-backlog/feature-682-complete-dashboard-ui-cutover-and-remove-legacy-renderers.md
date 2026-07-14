---
aigon_id: F682
complexity: high
set: dashboard-ui-rollout
depends_on:
  [681]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-14T22:10:09.362Z", actor: "cli/feature-prioritise" }
---

# Feature: Complete dashboard UI cutover and remove legacy renderers

## Summary

Make the contract-driven cards, responsive Pipeline, and live-operations Monitor the production dashboard, then remove the temporary preview switch and legacy state-specific renderers. This feature is the hardening and deletion step: it must prove action parity, responsive behavior, accessibility, live updates, and extension compatibility before removing the rollback path.

## User Stories

- [ ] As an operator, I receive the approved dashboard experience without enabling a preview setting.
- [ ] As an operator, every workflow and session action available before the rollout remains available in the correct state.
- [ ] As a maintainer, there is one production rendering path and one server-owned interaction contract rather than parallel legacy policy code.
- [ ] As a workflow developer, gallery coverage and production tests fail when a new state or action lacks a renderable contract scenario.

## Acceptance Criteria

- [ ] Contract-driven cards, responsive Pipeline, and live-operations Monitor are the only production dashboard implementations and require no preview setting.
- [ ] The temporary preview flag (including its `lib/dashboard-settings.js` entry and Settings UI control), dual-render selection logic, legacy card builders, legacy Monitor composition, superseded CSS, and browser-side lifecycle/action inference are removed.
- [ ] Compatibility status fields that F678 retained for the legacy renderer are audited: each is either removed or explicitly documented as still consumed by another surface (CLI, tests, Pro). No field survives solely for the deleted legacy renderer.
- [ ] Before deletion, an automated parity audit proves that every operator-visible action ID present in supported legacy feature, research, feature-set, Fleet, autonomous, recovery, review, evaluation, quota, failure, and close states is represented and executable in the contract UI.
- [ ] No current workflow action is hidden solely in an overflow menu when it is the state-clearing primary decision; destructive and exceptional actions retain confirmation behavior.
- [ ] Every retained running, completed, stopped, lost, and failed session still exposes Peek, and live versus saved-output routing is tested.
- [ ] Production cards and gallery scenarios share enough implementation or contract assertions that action/state drift cannot pass CI silently.
- [ ] `npm run gallery` remains a standalone living design and contract artifact on port 3700. It is not removed, folded into the real dashboard, or made dependent on a target repository.
- [ ] AGENTS.md and `docs/architecture.md` (§ Dashboard Frontend) explain the required sequence for a new state/action: update canonical definition/projector, add generated gallery facts, review Cards/Pipeline/Monitor at desktop and mobile, then update production only through a feature.
- [ ] The final Pipeline fills the operational viewport, preserves compact and expanded density, and has no document-level horizontal overflow at 390px.
- [ ] The final Monitor presents live operations rather than duplicating Pipeline and remains usable in desktop split and mobile stacked modes.
- [ ] SSE updates repaint all relevant contract changes without full-page refresh, duplicate cards, lost focus, stale selection, or avoidable layout shift.
- [ ] Repository switching, action confirmation, drag-and-drop, details, settings, filters, notifications, session Peek/attach, autonomous controls, set controls, empty/error/loading states, and Pro extension points pass regression coverage.
- [ ] Keyboard navigation, focus visibility, accessible names, menu semantics, contrast, reduced-motion behavior, and mobile touch targets meet the dashboard's supported browser baseline.
- [ ] Browser and gallery test suites include screenshot/overflow coverage at wide desktop, medium width, and 390px mobile and pass without ignored layout failures.
- [ ] Dead-code and CSS searches confirm there is no second transition table, state-label switch, or legacy action renderer left in production assets.
- [ ] Dashboard development server is restarted after `lib/*.js` changes and the final UI is manually verified against a repository containing representative state scenarios.

## Technical Approach

1. Run a contract/action parity report across generated gallery scenarios and representative production fixtures. Resolve gaps in workflow definitions or projectors before changing defaults.
2. Enable the new renderer unconditionally, remove the preview configuration surface, and delete the legacy paths in small reviewable commits within the feature branch.
3. Consolidate CSS manifest entries and remove selectors used only by the old Pipeline/Monitor. Verify other dashboard tabs and Pro-injected assets before deletion.
4. Strengthen CI so gallery coverage, production contract rendering, critical action dispatch, keyed live updates, and responsive overflow are required together.
5. Update contributor guidance with concrete file ownership and validation commands while preserving the rule that gallery approval alone does not authorize a production UI change.
6. Perform manual wide, medium, and mobile verification with features, research, sets, Fleet, autonomous review/revision, failures, recovery, close, and retained completed sessions.

## Validation

```bash
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
npm run test:browser:smoke
npm run test:iterate
npm test
```

## Dependencies

- `depends_on: 681` - requires completed contract adoption, shared renderer, responsive Pipeline, and live-operations Monitor.

## Out of Scope

- New lifecycle states, workflow actions, or autonomous orchestration behavior.
- Product analytics or historical reporting beyond the Monitor's bounded recent activity.
- Removing the gallery or treating gallery code as the production server.
- Unrelated dashboard visual redesigns outside the approved Pipeline, Monitor, and entity-card system.

## Open Questions

- None. This feature begins only after the previous set members have been exercised with the preview path and their implementation reviews are complete.

## Related

- Prior work: F675 interaction contract and F677 living gallery.
- Set members: F678-F681.
- Living reference: `npm run gallery` on port 3700.
