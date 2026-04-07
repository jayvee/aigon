<p align="center">
  <img src="assets/icon/aigon-icon.svg" width="96" height="96" alt="Aigon"/>
</p>

<h1 align="center">Aigon</h1>

<p align="center">
  <strong>Spec-driven AI development and multi-agent orchestration.</strong>
  <br/>
  Run Claude, Gemini, Codex, and Cursor as a team on the same feature — then ship the best result.
</p>

<p align="center">
  <a href="https://github.com/jayvee/aigon/actions/workflows/test.yml"><img alt="CI" src="https://github.com/jayvee/aigon/actions/workflows/test.yml/badge.svg"/></a>
  <a href="LICENSE"><img alt="License" src="https://img.shields.io/badge/license-Apache_2.0-blue.svg"/></a>
  <img alt="Node" src="https://img.shields.io/badge/node-%3E%3D18-brightgreen.svg"/>
  <a href="https://aigon.build"><img alt="Docs" src="https://img.shields.io/badge/docs-aigon.build-orange.svg"/></a>
</p>

<p align="center">
  <img src="site/public/img/aigon-dashboard-kanban.png" alt="Aigon Dashboard — kanban view" width="880"/>
</p>

> Aigon is an open source project by [Sen Labs](https://senlabs.ai). Follow [aigon.build](https://aigon.build) for updates.

---

## What is Aigon?

Aigon is a CLI-first workflow orchestrator for AI-assisted software development. You write a spec in Markdown, then let one agent implement it — or let several agents compete and pick the best result. Everything lives in plain files in your repo. No SaaS account, no vendor lock-in, no proprietary state.

It works with the AI coding tools you already use:

- 🤖 **Claude Code** (`cc`)
- 💎 **Gemini CLI** (`gg`)
- 📟 **Codex CLI** (`cx`)
- 🎯 **Cursor** (`cu`)

Mix and match. Aigon doesn't care which model writes the code — it just manages the workflow around them.

## Why Aigon?

- **Spec-driven** — features, research, and feedback are tracked as Markdown files in your repo. Human-readable, git-versioned, diffable. No opaque SaaS database.
- **Multi-agent Fleet mode** — run two or three agents on the same spec in parallel, compare the results, merge the winner. The only tool that does this across model vendors.
- **Solo Drive mode** — single agent, single worktree, single branch. Get in, implement, get out.
- **Autonomous mode** (in development as part of Aigon Pro) — AutoConductor runs implement → review → close unattended.
- **Research workflow** — parallel research topics across multiple agents, then synthesize and promote findings into features.
- **Feedback triage** — capture user input, de-duplicate, promote the actionable bits into features.
- **Dashboard** — web kanban for features/research/feedback, telemetry charts, session monitoring, logs. Runs on `localhost`.
- **No lock-in** — plain Markdown files in git. If Aigon disappears tomorrow, your specs and history are still there.
- **Vendor independent** — we orchestrate, you choose the model.

## Quick start

**Prerequisites:** Node.js 18+, Git 2.20+, and tmux (for Fleet/worktree mode). See the [Getting Started guide](https://aigon.build/docs/getting-started) for platform-specific install instructions.

```bash
# Install aigon
git clone https://github.com/jayvee/aigon.git ~/src/aigon
cd ~/src/aigon && npm install && npm link

# Set up your project
cd /path/to/your/project
aigon init
aigon install-agent cc        # Install the Claude Code agent
aigon doctor                  # Verify environment
```

Create and implement your first feature:

```bash
# Drive mode: one agent, one feature, straight to done
aigon feature-create "dark mode toggle with system preference detection"
aigon feature-prioritise dark-mode
aigon feature-start dark-mode cc    # Launches Claude Code in a worktree
```

Or from inside Claude Code, use the slash command fast path:

```
/aigon:feature-now dark-mode
Add a dark mode toggle with system preference detection...
```

## Demo

<p align="center">
  <img src="site/public/img/aigon-dashboard-02-fleet-evaluation.gif" alt="Aigon Fleet mode — evaluation in progress" width="880"/>
</p>

The [Aigon dashboard](https://aigon.build/docs/guides/dashboard) shows features across their full lifecycle — inbox → backlog → in-progress → in-evaluation → done — with live agent session status, commit activity, telemetry, and logs. Above: a Fleet-mode feature being evaluated across three agents.

## Documentation

Full documentation lives at **[aigon.build/docs](https://aigon.build/docs)**:

- 📘 [Getting Started](https://aigon.build/docs/getting-started) — install and run your first feature
- 🧭 [Core Concepts](https://aigon.build/docs/concepts) — workflows, execution modes, reliability
- 🛠 [Guides](https://aigon.build/docs/guides) — Drive, Fleet, Autopilot, Research, Dashboard, Telemetry
- 📚 [CLI Reference](https://aigon.build/docs/reference/commands) — every command documented
- 🔍 [Agents](https://aigon.build/docs/reference/agents) — Claude, Gemini, Codex, Cursor setup

## Aigon Pro (coming later)

Aigon Pro is a planned commercial tier bundling autonomous orchestration, Insights, and AI-powered coaching. **Pro is in development and not yet available for purchase** — the commands below will print a gate message and point you at the free alternative.

| Pro-gated command | What it does | Free alternative |
|---|---|---|
| `feature-autonomous-start <id>` | AutoConductor: implement → review → close unattended | `feature-start <id>` + `feature-do <id>` |
| `research-autopilot <id>` | Fleet research with auto spawn + monitor + evaluate | `research-start <id>` + `research-do <id>` |
| `aigon insights` | Insights, coaching, amplification metrics | `aigon board`, `aigon commits`, `aigon feature-status` |

The free tier — Drive mode, manual Fleet, the dashboard, interactive evaluation/review — is complete and stays free and open-source. There is no purchase flow today, and no "upgrade" CTA because there's nothing to sell yet. See the [Pro page](https://aigon.build/pro) for a preview of what's coming.

## Community and support

- 💬 [GitHub Discussions](https://github.com/jayvee/aigon/discussions) — questions, workflows, design ideas
- 🐛 [Issues](https://github.com/jayvee/aigon/issues) — bugs and concrete feature requests
- 📖 [Docs](https://aigon.build/docs) — the full manual
- 🧑‍💻 [Contributing](CONTRIBUTING.md) — how to set up a dev environment and submit PRs
- 🔒 [Security policy](SECURITY.md) — how to report vulnerabilities privately
- 📰 [aigon.build](https://aigon.build) — follow here for launch updates, release notes, and Pro announcements
- 🏢 [Sen Labs](https://senlabs.ai) — the company behind Aigon

## License

[Apache License 2.0](LICENSE) — Copyright 2025–2026 [Sen Labs](https://senlabs.ai)
