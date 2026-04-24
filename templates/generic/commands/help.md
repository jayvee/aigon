<!-- description: Show Aigon commands -->
# Aigon Commands

## Feature Commands (unified for Drive and Fleet modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feature-create <name>` | Create a new feature spec |
| `{{CMD_PREFIX}}feature-now <name>` | Fast-track: inbox → prioritise → setup → implement, or create new + implement |
| `{{CMD_PREFIX}}feature-prioritise <name>` | Assign ID and move to backlog |
| `{{CMD_PREFIX}}feature-start <ID> [agents...]` | Setup for Drive (branch) or Fleet (worktrees) |
| `{{CMD_PREFIX}}feature-do <ID> [--iterate]` | Do feature work; `--iterate` enables the Autopilot retry loop |
| `{{CMD_PREFIX}}feature-spec <ID> [--json]` | Resolve the canonical visible spec path for a feature |
| `{{CMD_PREFIX}}feature-list [--active] [--all] [--json]` | Query feature records without going through the board UI |
| `{{CMD_PREFIX}}feature-eval <ID>` | Create evaluation (code review or comparison) |
| `{{CMD_PREFIX}}feature-code-review <ID>` | Code review with fixes by a different agent |
| `{{CMD_PREFIX}}feature-code-revise [ID]` | Implementer-side: read the review and decide accept/challenge/modify (infers ID from worktree branch) |
| `{{CMD_PREFIX}}feature-spec-review <ID>` | Review the feature spec itself before implementation |
| `{{CMD_PREFIX}}feature-spec-revise <ID>` | Author-side: process pending spec reviews in one pass |
| `{{CMD_PREFIX}}feature-push [ID] [agent]` | Push feature branch to origin for PR review |
| `{{CMD_PREFIX}}feature-close <ID> [agent]` | Merge and complete feature |
| `{{CMD_PREFIX}}feature-cleanup <ID>` | Clean up Fleet worktrees and branches |
| `{{CMD_PREFIX}}feature-autonomous-start <ID> <agents...>` | Start autonomous feature flow with explicit stop-after control |
| `{{CMD_PREFIX}}feature-open [ID] [agent]` | Open feature worktree in terminal and start agent |

## Research (unified for Drive and Fleet modes)

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}research-create <name>` | Create a new research topic |
| `{{CMD_PREFIX}}research-prioritise <name>` | Prioritise a research topic |
| `{{CMD_PREFIX}}research-start <ID> [agents...]` | Setup for Drive or Fleet execution |
| `{{CMD_PREFIX}}research-open <ID>` | Re-open or attach Fleet research sessions |
| `{{CMD_PREFIX}}research-do <ID>` | Conduct research (write findings) |
| `{{CMD_PREFIX}}research-submit [ID]` | Signal research findings complete when using findings files |
| `{{CMD_PREFIX}}research-spec-review <ID>` | Review the research spec itself before execution |
| `{{CMD_PREFIX}}research-spec-revise <ID>` | Author-side: process pending research spec reviews in one pass |
| `{{CMD_PREFIX}}research-eval <ID>` | Evaluate or synthesize parallel findings |
| `{{CMD_PREFIX}}research-close <ID>` | Complete a research topic |

## Feedback

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}feedback-create <title>` | Create feedback item in inbox with next ID |
| `{{CMD_PREFIX}}feedback-list [filters]` | List feedback items with status/type/severity/tag filters |
| `{{CMD_PREFIX}}feedback-triage <ID>` | Run triage preview and apply with explicit confirmation |

## CLI Commands (run in terminal)

| Command | Description |
|---------|-------------|
| `aigon config init` | Create global config at `~/.aigon/config.json` |

### Agent CLI Mappings (used by feature-open)

| Code | Agent | Command | Mode |
|------|-------|---------|------|
{{AGENT_CLI_MAPPING_ROWS}}

**Quick-allow when prompted:** Claude `Shift+Tab` • Gemini `2` for always • Cursor "Add to allowlist" • Codex "Allow and remember"

**Override defaults:** Set `agents.{id}.implementFlag` in `~/.aigon/config.json` to use stricter permissions (e.g., `""` to require manual approval). Project config (`.aigon/config.json`) takes precedence over global config.

## Context-Aware

| Command | Description |
|---------|-------------|
| `{{CMD_PREFIX}}next` | Detect current context and suggest the most likely next workflow action |

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
| `/ah` | help | `/arsb` | research-submit |

Run `aigon help` in terminal for full CLI reference.
