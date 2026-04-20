# Implementation Log: Feature 291 - Dashboard Agent Model Picker

## Decisions
- Central `lib/agent-launch.js` is the only place callers resolve `{model, effort}` — every spawn path (feature-start, autopilot retry, dashboard restart, AutoConductor review) routes through `buildAgentLaunchInvocation` so the `feature.started` event is authoritative.
- Triplets transported dashboard→CLI as `--models=cc=sonnet-4-6 --efforts=cc=high` so `parseAgentOverrideMap()` stays the single parser; `verifyFeatureStartRegistration` filters `--`-prefixed args when checking expected agents.
- Snapshot read on close (`feature-close.js:snapshotFinalStats`) captures `effortOverride` into `stats.cost.byAgent[*]`; `stats-aggregate.js` adds `perTriplet` rollup keyed on `agent|model|effort` and bumps CACHE_VERSION=2 to invalidate old caches.
- cu has no `modelFlag`/`effortFlag`: `buildAgentLaunchInvocation` silently emits no flag but snapshot still records the "intended" triplet for attribution.
- Test budget raised 2090→2150 for the 25 LOC of round-trip regression (projector + resolveLaunchTriplet + buildAgentLaunchInvocation + perTriplet). Tried inlining into stats-aggregate.test.js but the projector/launch assertions need their own file.
