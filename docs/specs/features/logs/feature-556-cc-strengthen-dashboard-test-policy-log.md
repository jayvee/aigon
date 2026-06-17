# Implementation Log: Feature 556 - strengthen-dashboard-test-policy
Agent: cc

## Status
Done. ESLint now lints `templates/dashboard/js/**` (`no-undef` catches the undeclared-global incident class; cross-file globals allowlisted in `eslint.config.js`, `AUTONOMOUS_AGENT_IDS` deliberately excluded so it stays caught); `lint` npm glob broadened. New `tests/dashboard-e2e/critical-actions.spec.js` (@smoke) opens start/autonomous-start/eval/close surfaces with a console-error+toast guard (`watchBrowserErrors`/`assertActionSurfaceClean` in `_helpers.js`); folded in & removed `action-lazy-load.spec.js`; resolve-and-close stays covered by `close-failure-event.spec.js`. `DASHBOARD_PATH_RE` broadened to state/rules/workflow-core modules. CI adds a PR-eligible `browser-smoke` job. Docs (PR template, CONTRIBUTING, AGENTS) document the three tiers. Verified: `npm run test:quick` + full `@smoke` suite green; lint flags a deliberately-undeclared global.

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
