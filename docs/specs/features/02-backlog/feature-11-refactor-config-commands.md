# Feature: Refactor Config Commands

## Summary
The current CLI has confusing config command structure: `aigon config` manages **global** user config (`~/.aigon/config.json`) while `aigon profile` manages **project** config (`.aigon/config.json`). This is unintuitive — users expect `config` to be the unified entry point. Refactor to follow the git/npm pattern: a single `aigon config` command with `--global`/`--project` scope flags, defaulting to project scope.

## User Stories
- [ ] As a developer, I want a single `aigon config` command that handles both global and project settings so I don't have to remember which command manages which scope
- [ ] As a developer, I want to see where each config value comes from (global, project, or default) so I can debug configuration issues
- [ ] As a developer, I want `aigon config init` to set up project config (the most common case) without needing a flag

## Acceptance Criteria
- [ ] `aigon config set <key> <value>` writes to project `.aigon/config.json` (default scope)
- [ ] `aigon config set --global <key> <value>` writes to global `~/.aigon/config.json`
- [ ] `aigon config get <key>` shows effective value and which level it came from
- [ ] `aigon config show` shows merged effective config from all levels
- [ ] `aigon config show --global` and `aigon config show --project` show individual levels
- [ ] `aigon config init` creates project `.aigon/config.json` with sensible defaults (detected profile)
- [ ] `aigon config init --global` creates global `~/.aigon/config.json` (current `config init` behaviour)
- [ ] Dot-notation for nested keys: `aigon config set arena.testInstructions "run npm test"`
- [ ] `aigon profile` commands still work as convenience shortcuts (kept for ergonomics)
- [ ] Precedence order: project config > global config > defaults

## Technical Approach

### Unify under `aigon config` with scope flags

Follow git's pattern — `--global` flag for user-wide, project scope by default:

```bash
aigon config set <key> <value>               # project (default)
aigon config set --global <key> <value>      # global
aigon config get <key>                       # show value + source
aigon config show                            # merged effective config
aigon config show --global                   # global only
aigon config show --project                  # project only
aigon config init                            # init project config
aigon config init --global                   # init global config
```

### Dot-notation for nested keys

Support dot-path syntax for JSON nested structures:

```bash
aigon config set profile web                 # { "profile": "web" }
aigon config set arena.testInstructions "run npm test"
aigon config set --global terminal warp      # ~/.aigon: { "terminal": "warp" }
aigon config set --global agents.cc.implementFlag ""
```

### Keep `aigon profile` as convenience

`aigon profile` stays as a smart wrapper with auto-detection and port display:

```bash
aigon profile show          # rich display with auto-detect info + port summary
aigon profile set web       # shortcut for: aigon config set profile web
aigon profile detect        # show what auto-detect would pick
```

### Config provenance in `get`

Show where values come from:

```
$ aigon config get terminal
warp (from ~/.aigon/config.json)

$ aigon config get profile
web (from .aigon/config.json)

$ aigon config get agents.cc.implementFlag
--permission-mode acceptEdits (default)
```

### Current command mapping

| Current | New | Notes |
|---------|-----|-------|
| `aigon config init` | `aigon config init --global` | Global config creation |
| `aigon config show` | `aigon config show --global` | Global config display |
| (none) | `aigon config init` | Project config creation (NEW) |
| (none) | `aigon config set <key> <value>` | Project config set (NEW) |
| (none) | `aigon config get <key>` | Config get with provenance (NEW) |
| `aigon profile set web` | `aigon profile set web` | Kept as convenience |
| `aigon profile show` | `aigon profile show` | Kept, enhanced |
| `aigon profile detect` | `aigon profile detect` | Kept as-is |

## Dependencies
- None — self-contained refactor within `aigon-cli.js`

## Out of Scope
- XDG Base Directory compliance (`~/.config/aigon/` migration) — future enhancement
- Environment variable overrides for config values
- Config file format change (stays JSON)
- Removing `aigon profile` commands (kept as convenience shortcuts)

## Open Questions
- Should `aigon config init` (project) be interactive (prompt for profile, basePort) or just create with detected defaults?

## Related
- Research: CLI config patterns (git, npm, gcloud, aws, cargo) — conducted during feature 10
- Current code: `aigon-cli.js` lines ~3669 (`config` command) and ~3726 (`profile` command)
- Precedent: git uses `--global`/`--local`/`--system` flags; npm uses `--location=project`
