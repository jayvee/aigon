Shipped default-on `deepen.enabled` config resolution and valueless `--quick` stripping for both create parsers, covered by `tests/integration/deepen-create-controls.test.js`.

## Code Review

**Reviewed by**: cc (Opus 4.8)
**Date**: 2026-07-18

### Fixes Applied
- None — implementation was clean.

### Validation
- Validation not run by reviewer per policy.

### Escalated Issues (exceptions only)
- None.

### Notes
- All six acceptance criteria verified against the diff. Both parsers treat `--quick` as valueless (no index advance, not pushed to positional); the legacy `--description` path filters `--quick` out of the consumed tail. The stranded-args warning in `feature-create` also excludes `--quick` since it is in `knownFlags`.
- `deepen.enabled` resolves generically through `getConfigValueWithProvenance` (`getNestedValue`), so project > global > built-in `true` provenance works without any deepen-specific path. Seeded once in `buildDefaultGlobalConfigBase`.
- As a shared-scope key (absent from `USER_SCOPE_KEYS`/`REPO_SCOPE_KEYS`), both `config set` and `config set --global` are valid and project wins — matching the spec. `config set` coerces `true`/`false` to booleans, so the test's strict boolean assertions hold.
- Spec's "no unused `resolveDeepenEnabled` helper" and "no grill mention" constraints both honoured.
