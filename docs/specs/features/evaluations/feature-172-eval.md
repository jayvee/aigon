# Evaluation: Feature 172 - aigon-server

**Mode:** Fleet (Multi-agent comparison)
**Evaluator:** cc (anthropic/opus) — ⚠️ same-family as cc implementer

## Spec
See: `./docs/specs/features/04-in-evaluation/feature-172-aigon-server.md`

## Implementations to Compare

- [x] **cc** (Claude): `/Users/jviner/src/aigon-worktrees/feature-172-cc-aigon-server`
- [x] **cx** (Codex): `/Users/jviner/src/aigon-worktrees/feature-172-cx-aigon-server`

## Evaluation Criteria

| Criteria | cc | cx |
|----------|---|---|
| Code Quality | 8/10 | 7/10 |
| Spec Compliance | 9/10 | 9/10 |
| Performance | 8/10 | 8/10 |
| Maintainability | 8/10 | 7/10 |
| **Total** | **33/40** | **31/40** |

## Summary

| Agent | Lines | Score |
|---|---|---|
| cc | +837/-126 | 33/40 |
| cx | +762/-165 | 31/40 |

### Strengths & Weaknesses

#### cc (Claude)
- Strengths:
  - **Comprehensive test suite** — 15 tests including source-code invariant checks (verifies zero imports between modules, no tmux kill calls, no file moves)
  - **Clean dependency injection** — supervisor functions passed via `serverOptions` to dashboard, avoiding new orchestration files
  - **Separate service installer** — `supervisor-service.js` (192 lines) cleanly isolates launchd/systemd logic
  - supervisor.js at 276 lines — under budget, well-documented
- Weaknesses:
  - DI through dashboard's `serverOptions` is slightly indirect — function passing through options is harder to trace than an explicit composition root
  - Dashboard still retains some notification logic (agent-waiting, all-submitted) alongside supervisor's liveness notifications — split responsibility for notifications

#### cx (Codex)
- Strengths:
  - **Leaner supervisor** — 190 lines vs cc's 276, more focused
  - **Explicit orchestrator** — new `aigon-server.js` (262 lines) acts as a clear composition root that wires dashboard + supervisor, architecturally cleaner than injection
  - **More aggressive dashboard cleanup** — removed 107 lines vs cc's 71, including orphan UI button from dashboard JS
  - **Explicit process management** — PID file, SIGTERM→SIGKILL escalation, detached process spawning with state tracking in `~/.aigon/server/state.json`
- Weaknesses:
  - **Minimal test coverage** — only 4 tests vs cc's 15; no source-code invariant checks for module separation
  - **Extra file** — aigon-server.js adds 262 lines that partially overlap with what infra.js already handles in cc's approach
  - Service installation embedded in aigon-server.js rather than isolated

## Recommendation

**Winner: cc (Claude)**

CC wins on the strength of its test coverage (15 tests vs 4) and spec-aligned architecture. Both implementations meet all 14 acceptance criteria, but cc's comprehensive test suite — including invariant checks that verify module separation at the source level — provides significantly more confidence for ongoing maintenance. The 4-test suite in cx would not catch regressions in module boundaries.

**Cross-pollination:** Before merging, consider adopting from cx: the more aggressive dashboard cleanup (cx removed the orphan cleanup button from the dashboard JS templates, removing ~15 lines from `templates/dashboard/js/init.js` that cc left in place). Also worth noting cx's explicit PID file + state file pattern in `~/.aigon/server/` — if cc doesn't already track server state for `aigon server status`, cx's approach to process lifecycle tracking is cleaner.
