# Implementation Log: Feature 460 - poll-perf-dedupe-interval
Agent: cc

cc (solo): Added `options.baseState` to `getFeatureDashboardState` / `getResearchDashboardState` so the collector's empty-agents → full-agents bridge skips a duplicate snapshot+events read; bumped `POLL_INTERVAL_ACTIVE_MS` and browser `POLL_MS` from 10s → 20s.
