# Implementation Log: Feature 419 - aigon-repo-internal-doc-reorg
Agent: cc

Pure-docs reorg: moved aigon-next briefs → `docs/proposals/`, modularity review → `docs/reviews/2026-04-06/`, demo-guide + media → `docs/demos/`; created `docs/README.md` catalog and `docs/feature-sets.md` (+ template); patched stale module-map entries in `AGENTS.md` (dashboard-routes ~60-line aggregator, commands/setup ~3,492 lines, agent-registry ~655 lines + F414 helpers) and `docs/architecture.md`; replaced AGENTS Reading Order with single pointer to `docs/README.md`. No `lib/` changes; iterate-loop tests pass.
