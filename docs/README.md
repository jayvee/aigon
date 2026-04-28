# Aigon Internal Docs Catalog

Single entry point for every doc under `docs/`. One line per file: what's in it, when to read it. Start with `AGENTS.md` at the repo root for orientation, then come here.

## Engineering

- [architecture.md](architecture.md) — Full module docs, the `ctx` pattern, state architecture, write-path contract. Read when changing how `lib/` modules fit together. See § "Install manifest" for `lib/install-manifest.js` — the module that tracks install-agent footprint with sha256+version per file and enables `aigon uninstall`.
- [../.aigon/docs/development_workflow.md](../.aigon/docs/development_workflow.md) — Feature/research lifecycle, Solo vs Arena modes, spec-driven discipline. Read when working a feature for the first time. Vendored from `templates/docs/`; aigon-the-repo dogfoods it from `.aigon/docs/` (F421).
- [../.aigon/docs/feature-sets.md](../.aigon/docs/feature-sets.md) — What feature sets are, when to use them, how `set-prioritise` assigns IDs in dependency order. Vendored from `templates/docs/` (F421).
- [dashboard.md](dashboard.md) — Dashboard surface map: tabs, server-owned `validActions`, read-only rule.
- [workflow-rules.md](workflow-rules.md) — Action registry contract for feature/research/set workflow rules.
- [autonomous-mode.md](autonomous-mode.md) — AutoConductor loop, supervisor rules, what is and is not auto-decided.
- [testing.md](testing.md) — Unit/integration discipline, the 2,500-LOC test ceiling, REGRESSION-comment rule.
- [testing-dashboard.md](testing-dashboard.md) — Playwright harness, when `npm run test:ui` runs, mid-iteration skip rule.
- [testing-linux-docker.md](testing-linux-docker.md) — End-to-end Linux install verification via Docker/OrbStack.
- [`scripts/test-brewboard-migration.sh`](../scripts/test-brewboard-migration.sh) — End-to-end migration test: applies the F420–F422 doctor migrations (2.59.0/2.59.1/2.60.0/2.61.0) against a committed legacy fixture and asserts the resulting state matches the post-install contract. Run with `npm run test:migration`.
- [prompt-caching-policy.md](prompt-caching-policy.md) — Anthropic-prompt-cache discipline for Claude API code in this repo.
- [token-maxing.md](token-maxing.md) — Rolling-window mental model and the `aigon token-window` scheduler.
- [security.md](security.md) — Merge-gate scanning (gitleaks + semgrep), what blocks a close.
- [security-scanner.md](security-scanner.md) — Standalone `aigon security-scan` CLI surface.
- [linux-install.md](linux-install.md) — Linux-specific install caveats (terminal detection, tmux, signals).
- [../.aigon/docs/agents/](../.aigon/docs/agents/) — Per-agent notes (`cc.md`, `gg.md`, `cx.md`, `cu.md`, etc.). Vendored from `templates/generic/docs/agent.md`; aigon-the-repo dogfoods them from `.aigon/docs/agents/` (F421). Read the one for the agent you're operating.

## Reference

- [competitive/](competitive/) — Landscape, matrix, weaknesses, per-competitor entries.
- [marketing/](marketing/) — Positioning, multi-agent narrative, screenshots.
- [reports/](reports/) — Dated investigation reports (dependency sweeps, simplification rounds).
- [generated/](generated/) — Auto-generated artifacts (workflow diagrams). Do not hand-edit.

## Proposals

Forward-looking design docs that are not yet (or may never be) implemented.

- [proposals/aigon-next-operator-brief.md](proposals/aigon-next-operator-brief.md) — Short Codex handoff prompt for the aigon-next prototype.
- [proposals/aigon-next-prototype-bootstrap.md](proposals/aigon-next-prototype-bootstrap.md) — Long-form bootstrap document for a new workflow-core prototype.

## Reviews

Point-in-time reviews; dated and frozen.

- [reviews/2026-04-06/modularity-review.md](reviews/2026-04-06/modularity-review.md) — Balanced-coupling review of the codebase as of 2026-04-06 (HTML companion alongside).

## Demos

Recording assets and the demo guide.

- [demos/demo-guide.md](demos/demo-guide.md) — Brewboard seed walkthrough used in demos.
- [demos/media/README.md](demos/media/README.md) — Promotional GIF deliverables, optimize/validate scripts.

## Notes

Scratch / informal investigations — not authoritative, not necessarily up to date.

- [notes/codex-config-audit.md](notes/codex-config-audit.md) — Audit of Codex MCP/config behaviour for the install-contract work.

## Specs

`specs/` is the live workflow state for features, research, and feedback. Browse via the dashboard or `aigon feature-list` / `aigon research-list` — do not read raw spec files as a query API.
