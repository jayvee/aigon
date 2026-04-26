---
commit_count: 5
lines_added: 574
lines_removed: 75
lines_changed: 649
files_touched: 12
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: false
rework_fix_cascade: false
rework_scope_creep: false
input_tokens: 268
output_tokens: 115813
cache_creation_input_tokens: 1091539
cache_read_input_tokens: 23747857
thinking_tokens: 0
total_tokens: 24955477
billable_tokens: 116081
cost_usd: 64.7781
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 397 - engine-first-folder-fallback-correctness
Agent: cc

Engine-first precedence applied via new `lib/workflow-core/entity-lifecycle.js` (`isEntityDone` + `engineDirExists`); 9 violation sites fixed; drift case now distinguished from pre-start via `engineDirExists` flag and recorded as `spec.drift_corrected` event.
