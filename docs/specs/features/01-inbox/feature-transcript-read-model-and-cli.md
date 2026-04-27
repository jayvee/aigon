---
complexity: medium
set: transcript-program
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-26T13:05:44.697Z", actor: "cli/feature-prioritise" }
---

# Feature: transcript-read-model-and-cli

## Summary
Expose the agent transcript pointers that F357 already records (`agentSessionId` + `agentSessionPath` on `.aigon/sessions/{name}.json`) through a server-owned read-model API and a small CLI. Zero new write paths — this is a pure read-side feature that turns existing data into user value. First step in the research-43 transcript program: ship the visibility layer before building durable storage.

## User Stories
- [ ] As an operator, I run `aigon feature-transcript <ID> [agent]` and get the path to the live native transcript for that feature/agent (or a list of all sessions if no agent specified).
- [ ] As a dashboard user, I see a "Open transcript" link/button on each agent row that opens the transcript via the server (never a direct file:// from the browser, per dashboard read-only rule).
- [ ] As a researcher comparing agents, I run `aigon research-transcript <ID>` to retrieve all transcript pointers across the Fleet agents that worked on a research topic.

## Acceptance Criteria
- [ ] New API endpoint(s) under the existing dashboard route table (`lib/dashboard-routes.js`) return per-entity, per-agent transcript pointers + telemetry summary (no body content; pointer + meta only).
- [ ] Read path lives in `lib/dashboard-status-collector.js` (or a new `lib/transcript-read.js` if the collector grows too large) — never parsed in `dashboard-server.js` or frontend code.
- [ ] CLI commands: `aigon feature-transcript <ID> [agent]` and `aigon research-transcript <ID> [agent]` print resolved path(s); `--open` flag opens the path in the user's default editor/viewer.
- [ ] Missing-pointer case (cu/op/km, or pre-F357 sessions) returns a structured "not captured" response with a one-line explanation, never a stack trace.
- [ ] Test coverage in `tests/` with `// REGRESSION:` comment naming the missing-pointer case.

## Pre-authorised

## Technical Approach
- Reuse `lib/session-sidecar.js` helpers (`readLatestSidecarWithSession`) — do not parse sidecar JSON elsewhere.
- Join with `lib/telemetry.js` records via `entityId + agent + sessionId` so the API response includes model, tokens, cost without re-reading transcript bodies.
- CLI handlers go in `lib/commands/entity-commands.js` (parallel feature/research factory) so both entities pick them up by construction, per AGENTS.md § Where To Add Code.
- Dashboard route registered via standard pattern; frontend rendering deferred to a follow-up if needed (this feature ships the API + CLI; UI surface can be a separate small change).

## Dependencies
-

## Out of Scope
- Copying transcript bodies to durable storage (that's `transcript-durable-hot-tier`).
- Universal `tmux pipe-pane` capture (that's `transcript-tmux-pipe-pane-optin`).
- Cold tier upload, redaction-at-export, side-by-side compare UI.

## Open Questions
- Should `--open` use `$EDITOR` or a platform-specific viewer (`open` on macOS, `xdg-open` on Linux)? Default to `$EDITOR` if set, fall back to platform open.
- Should the API include a small head/tail of the body (last N turns) for quick preview, or strictly pointer-only? Default: pointer-only; previews can come later.

## Related
- Research: 43 — session-transcript-capture-and-storage
- Set: transcript-program
