# Implementation Log: Feature 397 - engine-first-folder-fallback-correctness
Agent: cc

Engine-first precedence applied via new `lib/workflow-core/entity-lifecycle.js` (`isEntityDone` + `engineDirExists`); 9 violation sites fixed; drift case now distinguished from pre-start via `engineDirExists` flag and recorded as `spec.drift_corrected` event.
