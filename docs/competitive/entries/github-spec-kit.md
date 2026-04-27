# GitHub Spec Kit

- **Slug:** `github-spec-kit`
- **Tier:** B — spec-driven workflow tool
- **Repo:** [`github/spec-kit`](https://github.com/github/spec-kit)
- **License:** OSS
- **Last verified:** 2026-04-27 (R44)

## What it is
`/specify` `/plan` `/tasks` `/implement` slash commands, supports 30+ agents, Python CLI bootstrap, project "constitution" file. Closest to Aigon's slash-command + spec model — but explicitly **not** an orchestrator.

## Matrix cells (public 5)
- **Unit of work:** spec
- **Source of truth:** Markdown specs in git
- **Multi-agent posture:** single-agent (delegates to one of 30+ host agents)
- **Model flexibility:** any of 30+ agents (one at a time)
- **Pricing:** free OSS + BYO

## Closest to Aigon on
Markdown specs in git as the unit of work. Slash-command surface inside agents.

## Where it beats Aigon
- 30+ agent support out of the box.
- Project `constitution.md` — durable cross-spec rules.
- Lightest spec wrapper in the field.

## Where Aigon wins
- Multi-agent posture — Spec Kit runs one agent at a time per spec.
- Full Kanban lifecycle (inbox → done) vs Spec Kit's per-spec-only scope.
- Built-in evaluation step as the merge gate.
- Dashboard surface.

## Sources
- [github.com/github/spec-kit](https://github.com/github/spec-kit)
- [Spec Kit vs BMAD vs OpenSpec — DEV](https://dev.to/willtorber/spec-kit-vs-bmad-vs-openspec-choosing-an-sdd-framework-in-2026-d3j)
