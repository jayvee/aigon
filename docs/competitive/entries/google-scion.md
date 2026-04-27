# Google Scion

- **Slug:** `google-scion`
- **Tier:** A — direct competitor
- **Repo:** [`GoogleCloudPlatform/scion`](https://github.com/GoogleCloudPlatform/scion)
- **License:** OSS (open-sourced 2026-04-07)
- **Last verified:** 2026-04-27 (R44)

## What it is
"Hypervisor for AI agents": isolated container + git worktree + credentials per agent. Supports Claude Code, Gemini CLI, OpenCode, Codex. Runs locally, on remote VMs, or on Kubernetes. Local mode stable; hub mode ~80% verified.

## Matrix cells (public 5)
- **Unit of work:** task graph node
- **Source of truth:** hosted graph (or local)
- **Multi-agent posture:** parallel + sequential, declarative graph
- **Model flexibility:** BYO Claude Code / Gemini / OpenCode / Codex
- **Pricing:** free OSS + BYO

## Closest to Aigon on
Multi-vendor agent support and local-first execution. Strategically the most significant new entrant since R21.

## Where it beats Aigon
- Container-grade isolation (Docker / Kubernetes / Apple containers) vs Aigon's worktree-only.
- Declarative task graphs — explicit dependency DAG.
- Google backing — credibility and likely future enterprise integrations.

## Where Aigon wins
- Lightweight by default — no Docker / k8s required to start.
- Markdown specs in git as the unit of work, vs Scion's graph nodes.
- Cross-agent evaluation as a first-class merge gate.
- Kanban lifecycle (inbox → done) instead of single task graphs.

## Sources
- [Google Scion — InfoQ](https://www.infoq.com/news/2026/04/google-agent-testbed-scion/)
- [github.com/GoogleCloudPlatform/scion](https://github.com/GoogleCloudPlatform/scion)
- [Scion: A Hypervisor for AI Agents — Agent Wars](https://agent-wars.com/news/2026-04-07-google-scion-hypervisor-ai-agents-open-source)
