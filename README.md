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

## Aigon Pro

Aigon Pro adds agent quality metrics, trend charts, and AI-powered coaching to your dashboard. See which agents deliver, track improvements over time, and get actionable recommendations. [Learn more at aigon.build/pro](https://aigon.build/pro).

Aigon itself remains free and open-source.

## License

MIT
