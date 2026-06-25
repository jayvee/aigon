# Implementation Log: Feature 590 - dashboard-perf-improvements
Agent: cc

Lean done rows (both collector loops, bounded to recent 15 via `buildLeanDoneFeatureRow`), `allFeatures` off the poll path behind `GET /api/repos/all-features` (`collectAllFeaturesLean`) with lazy client fetch in `logs.js`, gzip in `sendJsonSerialized` (>8KB + `Accept-Encoding`), and perf logging (server poll >1s auto-log + `/api/status` serialize/bytes; client `poll()` breakdown behind `?debug=perf`). Tests: `tests/integration/dashboard-perf-lean-done.test.js`; state-consistency smoke scoped heavy-field asserts to non-done rows.

## Code Review

**Reviewed by**: cu
**Date**: 2026-06-25

### Fixes Applied
- 600023992 fix(review): revert unrelated inbox specs; skip allFeatures on poll path

### Validation
- Validation not run by reviewer per policy

### Escalated Issues (exceptions only)
- None

### Notes
- Core F590 implementation (lean done rows, bounded poll payload, gzip via `sendJsonSerialized`, lazy `/api/repos/all-features`, server/client perf logging, integration tests) matches the spec and R47 direction.
- Review found the branch had deleted/replaced unrelated antigravity inbox specs — reverted to match `main`.
- Poll path was still building the full `allFeatures`/`extraDone` list every cycle (only stripped before serialize); now gated behind `includeAllFeatures` on `collectFeatures`.
- All Items lazy fetch now loads only repos missing from cache (handles conductor adding repos mid-session); cached list still does not live-update on poll — intentional per spec's "first mount" wording.
