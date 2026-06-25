# Implementation Log: Feature 590 - dashboard-perf-improvements
Agent: cc

Lean done rows (both collector loops, bounded to recent 15 via `buildLeanDoneFeatureRow`), `allFeatures` off the poll path behind `GET /api/repos/all-features` (`collectAllFeaturesLean`) with lazy client fetch in `logs.js`, gzip in `sendJsonSerialized` (>8KB + `Accept-Encoding`), and perf logging (server poll >1s auto-log + `/api/status` serialize/bytes; client `poll()` breakdown behind `?debug=perf`). Tests: `tests/integration/dashboard-perf-lean-done.test.js`; state-consistency smoke scoped heavy-field asserts to non-done rows.
