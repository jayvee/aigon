# Implementation Log: Feature 404 - agent-lifecycle-signal-rename
Agent: cc

Renamed completion signals (`implementation-complete` / `revision-complete` / `spec-review-complete` / `research-complete`) with deprecation aliases for `submitted` + `feedback-addressed`; added `revising`/`spec-reviewing` start signals; trap + start signal now record `taskType` for mismatch detection in `lib/commands/misc.js`.
