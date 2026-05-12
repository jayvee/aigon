# Aigon Commands

## Feature Commands (unified for Drive and Fleet modes)

| Command | Description |
|---------|-------------|
| `/aigon-feature-create <name>` | Create a new feature spec |
| `/aigon-feature-now <name>` | Fast-track: inbox → prioritise → setup → implement, or create new + implement |
| `/aigon-feature-prioritise <name>` | Assign ID and move to backlog |
| `/aigon-feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `/aigon-feature-do <ID> [--iterate]` | Do feature work; `--iterate` enables the Autopilot retry loop |
| `/aigon-feature-spec <ID> [--json]` | Resolve the canonical visible spec path for a feature |
| `/aigon-feature-list [--active] [--all] [--json]` | Query feature records without going through the board UI |
| `/aigon-feature-eval <ID>` | Create evaluation (code review or comparison) |
| `/aigon-feature-code-review <ID>` | Code review with fixes by a different agent |
| `/aigon-feature-code-revise [ID]` | Implementer-side: read the review and decide accept/challenge/modify (infers ID from worktree branch) |
| `/aigon-feature-spec-review <ID>` | Review the feature spec itself before implementation |
| `/aigon-feature-spec-revise <ID>` | Author-side: process pending spec reviews in one pass |
| `/aigon-feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `/aigon-feature-close <ID> [agent]` | Merge and complete feature |
| `/aigon-feature-cleanup <ID>` | Clean up Fleet worktrees and branches |
| `/aigon-feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `/aigon-feature-open [ID] [agent]` | Open feature worktree in terminal and start agent |

## Research (unified for Drive and Fleet modes)

| Command | Description |
|---------|-------------|
| `/aigon-research-create <name>` | Create a new research topic |
| `/aigon-research-prioritise <name>` | Prioritise a research topic |
| `/aigon-research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `/aigon-research-open <ID>` | Re-open or attach Fleet research sessions |
| `/aigon-research-do <ID>` | Conduct research (write findings) |
| `/aigon-research-spec-review <ID>` | Review the research spec itself before execution |
| `/aigon-research-spec-revise <ID>` | Author-side: process pending research spec reviews in one pass |
| `/aigon-research-eval <ID>` | Evaluate or synthesize parallel findings |
| `/aigon-research-close <ID>` | Complete a research topic |

## Feedback

| Command | Description |
|---------|-------------|
| `/aigon-feedback-create <title>` | Create feedback item in inbox with next ID |
| `/aigon-feedback-list [filters]` | List feedback items with status/type/severity/tag filters |
| `/aigon-feedback-triage <ID>` | Run triage preview and apply with explicit confirmation |

## CLI Commands (run in terminal)

| Command | Description |
|---------|-------------|
| `aigon config init` | Create global config at `~/.aigon/config.json` |

### Agent CLI Mappings (used by feature-open)

| Code | Agent | Command | Mode |
|------|-------|---------|------|
| cc | Claude Code | `claude --permission-mode acceptEdits` | Auto-edits, prompts for risky Bash |
| gg | Gemini | `gemini --yolo` | Auto-approves all |
| cx | Codex | `codex` | Workspace-write, smart approval |
| cu | Cursor | `agent --force` | Auto-approves commands (yolo mode) |
| op | OpenCode | `opencode` | Workspace-write, smart approval |
| km | Kimi Code CLI | `kimi --yolo` | Auto-approves all |

**Quick-allow when prompted:** Claude `Shift+Tab` • Gemini `2` for always • Cursor "Add to allowlist" • Codex "Allow and remember"

**Override defaults:** Set `agents.{id}.implementFlag` in `~/.aigon/config.json` to use stricter permissions (e.g., `""` to require manual approval). Project config (`.aigon/config.json`) takes precedence over global config.

## Context-Aware

| Command | Description |
|---------|-------------|
| `/aigon-next` | Detect current context and suggest the most likely next workflow action |

## Shortcuts

All commands have top-level short aliases prefixed with `a` (for aigon):

| Shortcut | Command | Shortcut | Command |
|----------|---------|----------|---------|
| `/afc` | feature-create | `/arc` | research-create |
| `/afn` | feature-now | `/arp` | research-prioritise |
| `/afp` | feature-prioritise | `/ars` | research-start |
| `/afs` | feature-start | `/aro` | research-open |
| `/afd` | feature-do | `/ard` | research-do |
| `/afe` | feature-eval | `/are` | research-eval |
| `/afr` | feature-code-review | `/arcl` | research-close |
| `/afrv` | feature-code-revise | | (codex: `$aigon-feature-code-revise`) |
| `/afsr` | feature-spec-review | `/arsr` | research-spec-review |
| `/afsrv` | feature-spec-revise | `/arsrv` | research-spec-revise |
| `/afcl` | feature-close | `/arap` | research-autopilot |
| `/ab` | board | `/afbc` | feedback-create |
| `/afbl` | feedback-list | `/afbt` | feedback-triage |
| `/ads` | dev-server | `/an` | next |
| `/ah` | help | | |

Run `aigon help` in terminal for full CLI reference.
