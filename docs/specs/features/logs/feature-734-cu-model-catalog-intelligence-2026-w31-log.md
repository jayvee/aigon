# Implementation Log: Feature 734 - model-catalog-intelligence-2026-w31
Agent: cu

## Status

W31 complete — auto-applied pricing/archive; maintainer approved all 9 yes/no items: added qwen3.8-max, v4-flash-0731, qwen3.7-flash, inkling-small with summaries; promoted qwen3.6-35b-a3b to complexityDefaults low.

## New API Surface

## Key Decisions

- Archived active `devstral-2512` — zero `mistralai/devstral*` rows on OpenRouter as of 2026-08-05; superseded by `codestral-2508`.
- Pricing conversion: OpenRouter API per-token rates × 1e6 → registry USD/MTok (existing `buildOpenRouterCatalogIndex` stores per-token).
- Research cap: 4 NEW models researched (qwen3.8-max, v4-flash-0731, qwen3.7-flash, inkling-small); 6 stale summaries deferred.

## Gotchas / Known Issues

- `buildOpenRouterCatalogIndex` returns per-token pricing — weekly task must multiply by 1e6 before patching registry.
- Codestral probe returned marketing text instead of PONG but probe script marked PASS.

## Explicitly Deferred

- Summary refresh for 6 stale active models (research cap).
- Aigon brewboard benches — OSS has no bench tooling; confidence capped at MED.

## For the Next Feature in This Set

- Maintainer answers on 4 NEW model adds + summary patches in report yes/no section.

## Test Coverage

- `npm run test:iterate` — agent-registry-contract passes after op.json edits.
