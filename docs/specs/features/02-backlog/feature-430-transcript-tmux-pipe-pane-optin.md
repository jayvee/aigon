---
complexity: medium
set: transcript-program
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T04:14:45.423Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-04-26T13:05:45.033Z", actor: "cli/feature-prioritise" }
---

# Feature: transcript-tmux-pipe-pane-optin

## Summary
Provide an opt-in `tmux pipe-pane` capture path for agents that have no native transcript file (cu, op, km), gated behind `~/.aigon/config.json:transcripts.tmux=true`. Output flows to `~/.aigon/transcripts/<repo>/.../<role>-<sessionUuid>.tmux.log` outside the worktree. Off by default — the conservative position from research-43 (raw ANSI noise + secrets-in-pane risk + 5-10× size cost don't justify a universal default). Final piece of the research-43 transcript program.

## User Stories
- [ ] As an operator running a Cursor session, I can opt in via `aigon config set transcripts.tmux true` and get a transcript artifact for `cu` even though Cursor has no native log.
- [ ] As a privacy-conscious user, I can leave the flag off and aigon never spawns a `pipe-pane` — pane content stays ephemeral in tmux as today.
- [ ] As a debugger, when an `op` (OpenCode) session goes wrong, opt-in capture lets me see what actually rendered in the pane, not just the dispatched router calls.

## Acceptance Criteria
- [ ] New config key `transcripts.tmux` (boolean, default `false`) in `~/.aigon/config.json`. Documented in `lib/config.js`.
- [ ] When the flag is true, `createDetachedTmuxSession` in `lib/worktree.js` attaches `tmux pipe-pane -t $TMUXID -O 'cat >> <path>'` immediately after `new-session` succeeds and the sidecar is written.
- [ ] Capture only fires for agents NOT in `CAPTURABLE_AGENTS` (i.e. cu, op, km, future non-native agents) — agents with native logs continue using the F357 sidecar binding only, no double capture.
- [ ] Output path: `~/.aigon/transcripts/<repo>/<entityType>/<entityId>/<agent>/<role>-<sessionUuid>.tmux.log`. Same key scheme as `transcript-durable-hot-tier`.
- [ ] Size cap per file (configurable, default 100 MB) — when exceeded, rotate to `.tmux.log.1` and start fresh; cap retained files at 3 to avoid runaway growth.
- [ ] Tear-down: when the tmux session ends, the `pipe-pane` cat process exits naturally — verify this in tests, no zombie processes.
- [ ] Read-model from `transcript-read-model-and-cli` includes `tmuxLogPath` when present.
- [ ] Test coverage with `// REGRESSION:` comments for: flag-off → no pipe-pane spawned; flag-on + cu → pipe-pane attached; flag-on + cc → no pipe-pane (native takes precedence); rotation triggers at size cap.

## Pre-authorised

## Technical Approach
- Read flag via existing `lib/config.js` getter (no new config infrastructure).
- Single change site: `lib/worktree.js:createDetachedTmuxSession`. After `runTmux(['new-session', ...])` succeeds and sidecar is written, branch on `(transcriptCaptureEnabled() && !CAPTURABLE_AGENTS.has(agentId))`.
- Path resolution via `lib/transcript-store.js` (created in `transcript-durable-hot-tier`); reuse the same key scheme.
- Size cap implementation: a tiny shell wrapper script that wraps `cat` and rotates at threshold — or use `logrotate`-style external rotation via a periodic check (decide during implementation; first pass can ship without rotation if simpler, with a TODO).
- No daemon, no long-lived process beyond what tmux already spawns for `pipe-pane`.

## Dependencies
- depends_on: transcript-durable-hot-tier

## Out of Scope
- Universal `pipe-pane` for cc/gg/cx (those have native logs; double-capture is wasteful and adds privacy surface).
- Redaction at capture time — output is verbatim, matches Claude's own behaviour. Redaction happens at export.
- Stuck-detection signal from byte growth (separate future feature; deferred per research synthesis).
- ANSI sanitisation / pretty rendering — raw stream only; rendering can be a follow-up reader.

## Open Questions
- Should the size cap rotate or simply truncate? Rotate is more useful for forensic work; truncate is simpler. Default to rotate-with-cap-3.
- Should we expose a per-agent override (`transcripts.tmux.cu = true` while `transcripts.tmux = false`)? Probably yes via deep-key config, but only if implementation cost is trivial — otherwise defer.

## Related
- Research: 43 — session-transcript-capture-and-storage
- Set: transcript-program
- Prior features in set: transcript-read-model-and-cli, transcript-durable-hot-tier
