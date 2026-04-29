# Implementation Log: Feature 456 - agent-bench-health-signal
Agent: cc

`lib/bench-hydrate.js` indexes `.aigon/benchmarks/` (all-pairs trumps per-run) and `/api/quota` merges `benchVerdict` into each model entry; picker labels probe-ok-but-not-bench-passed pairs with `⚠` + tooltip, and `agent-probe --include-bench` adds a bench column.
