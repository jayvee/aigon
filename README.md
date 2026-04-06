# Aigon

<img src="assets/icon/aigon-icon.svg" width="64" height="64" alt="Aigon"/>

**Spec-driven AI development and multi-agent orchestration.**

Aigon is a CLI-first, vendor-independent workflow for research, feature delivery, and feedback loops across Claude, Gemini, Codex, and Cursor.

- **Spec-driven:** features, research, and feedback tracked as Markdown files in your repo
- **Multi-agent:** run one agent (Drive) or orchestrate competing implementations (Fleet)
- **Vendor independent:** works across Claude Code, Gemini CLI, Codex CLI, and Cursor
- **No lock-in:** plain files in Git, no SaaS account required

## Quick start

**Prerequisites:** Node.js 18+, Git 2.20+, and tmux (for Fleet/worktree mode). See the [Getting Started guide](https://aigon.build/docs/getting-started) for platform-specific install instructions.

```bash
git clone https://github.com/jayvee/aigon.git ~/src/aigon
cd ~/src/aigon && npm install && npm link

cd /path/to/your/project
aigon init
aigon install-agent cc        # Install Claude Code agent
```

Then in Claude Code:
```
/aigon:feature-now dark-mode
Add a dark mode toggle with system preference detection...
```

## Documentation

Full documentation at **[aigon.build/docs](https://aigon.build/docs)**

- [Getting Started](https://aigon.build/docs/getting-started) — install and run your first feature
- [Core Concepts](https://aigon.build/docs/concepts) — workflows, modes, and surfaces
- [Guides](https://aigon.build/docs/guides) — Drive, Fleet, Autopilot, Research, Dashboard
- [CLI Reference](https://aigon.build/docs/reference/commands) — every command documented

## Aigon Pro (coming later)

Aigon Pro is a planned commercial tier bundling autonomous orchestration, AADE Insights, and AI-powered coaching. **Pro is in development and not yet available for purchase** — the commands below will print a gate message and point you at the free alternative.

| Pro-gated command | What it does | Free alternative |
|---|---|---|
| `feature-autonomous-start <id>` | AutoConductor: implement → review → close unattended | `feature-start <id>` + `feature-do <id>` |
| `feature-do <id> --autonomous` | Autopilot loop: implement → validate → retry with fresh context | `feature-do <id>` (interactive) |
| `research-autopilot <id>` | Fleet research with auto spawn + monitor + evaluate | `research-start <id>` + `research-do <id>` |
| `aigon insights` | AADE Insights, coaching, amplification metrics | `aigon board`, `aigon commits`, `aigon feature-status` |

The free tier — Drive mode, manual Fleet, the dashboard, interactive evaluation/review — is complete and stays free and open-source. There is no purchase flow today, and no "upgrade" CTA because there's nothing to sell yet.

## License

MIT
