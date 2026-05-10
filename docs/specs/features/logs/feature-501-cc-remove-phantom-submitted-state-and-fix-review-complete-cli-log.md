# Implementation Log: Feature 501 - remove-phantom-submitted-state-and-fix-review-complete-cli
Agent: cc

Lifecycle `submitted` → `ready` everywhere; reviewer must pass `--approve` / `--request-revision`; doctor --fix rewrites legacy snapshots so f495 closes cleanly. See commit 9ce8b496.
