---
commit_count: 10
lines_added: 9302
lines_removed: 419
lines_changed: 9721
files_touched: 89
fix_commit_count: 0
fix_commit_ratio: 0
rework_thrashing: true
rework_fix_cascade: false
rework_scope_creep: true
input_tokens: 267
output_tokens: 119939
cache_creation_input_tokens: 337404
cache_read_input_tokens: 33282180
thinking_tokens: 0
total_tokens: 33739790
billable_tokens: 120206
cost_usd: 65.249
sessions: 1
model: "claude-opus-4-7"
tokens_per_line_changed: null
---
# Implementation Log: Feature 502 - template-install-drift-guard
Agent: cc

Three drift layers (L1 startup warning + L2 silent version-bump reinstall + L3 lockstep CI test) plus `aigon doctor --fix-templates` and a `prepublishOnly` lockstep guard; manifest schema gains `agents`, `agentInstalls`, and per-entry `templateSha` for content-based detection.

## Status

## New API Surface

## Key Decisions

## Gotchas / Known Issues

## Explicitly Deferred

## For the Next Feature in This Set

## Test Coverage
