---
complexity: low
research: 47
set: dashboard-perf
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-30T00:20:17.822Z", actor: "cli/feature-prioritise" }
---

# Feature: dashboard-perf-1-cold-probe-ttl

## Summary

Move expensive infrastructure probes that today run on every dashboard poll behind explicit TTL caches. Targets: `parseCaddyRoutes`, `getDevServerState` port probes, `detectGitHubRemote`, default-branch detection, and the Pro `buildPendingScheduleIndex` lookup. None of these represent workflow state — Caddy routes, dev-server ports, and git remote URLs change rarely and are non-correctness-critical at 60–300 s staleness. Removes `execSync` calls and several hundred file reads from steady-state polls.

## User Stories
- [ ] As a dashboard user, I do not pay for Caddy/dev-server/git probes on every 20 s poll
- [ ] As an operator, I can read or override the per-probe TTL in one place

## Acceptance Criteria
- [ ] A small TTL helper wraps each probe call site (single `Map<key, {value, expiresAt}>`)
- [ ] Default TTLs: Caddy 120 s, dev-server 60 s, git-remote 300 s, default-branch 300 s, schedule index 60 s
- [ ] `/api/status` polls do not trigger these probes when the cached value is fresh
- [ ] Probe results identical to today's behaviour when cache is cold or expired
- [ ] No new persistent state — TTL cache is in-process only

## Technical Approach

Add `lib/probe-ttl-cache.js` exposing `getOrCompute(key, ttlMs, computeFn)`. Wrap each probe call site at its existing entry point. No invalidation hooks needed — TTL expiry is the only invalidation signal. This is deliberately not mtime-gated: these probes don't have a reliable mtime signal (Caddy config might be edited externally, ports change asynchronously) and the data isn't workflow state, so a fixed TTL is the right primitive.

## Dependencies
-

## Out of Scope
- Caching workflow state (covered separately by `dashboard-perf-2-status-cache`)
- Frontend changes
- Configurable TTLs via UI

## Related
- Research: #47 dashboard-perf-and-state-architecture
- Set: dashboard-perf
