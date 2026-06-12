---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T04:27:55.770Z", actor: "cli/feature-prioritise" }
---

# Feature: Doctor Enhanced Health Checks

Extend `aigon doctor` with five new check categories — agent authentication
status, live model availability, terminal-app installation, multi-repo aigon
version sweep, and tmux server liveness — plus an interactive auto-remediation
pass (`--fix`) that can open login sessions and run `apply` in stale repos.

## Background

Current `doctor` verifies that agent CLIs are on PATH and that model metadata
exists in templates, but it does not confirm whether the user is actually
logged in. A fresh machine, an expired token, or a rate-limited session will
all show ✅ today and silently fail at `feature-start` time. Likewise, the
configured terminal app (iTerm2, Warp, Ghostty, etc.) is never validated, and
repos that are many minor versions behind go unnoticed until something breaks.

## User Stories

- [ ] As a user running `aigon doctor`, I see which agents I'm authenticated
  to so I know immediately whether I can start work.
- [ ] As a user on a new machine, `aigon doctor --fix` opens a login session
  for each unauthenticated agent — I don't have to manually look up the auth
  command for each one.
- [ ] As a user, I can see at a glance which registered repos have a stale
  aigon version and trigger `aigon apply` in them from one command.
- [ ] As a user, doctor warns me if the terminal app in my config isn't
  installed so I know why `feature-open` might fail.
- [ ] As a user, doctor tells me whether the tmux server is actually running
  (not just that tmux is installed).

## Acceptance Criteria

### Agent Auth Check
- [ ] For each installed agent CLI, doctor reports one of: ✅ authenticated,
  ⚠️ unauthenticated, or ℹ️ auth-method unknown.
- [ ] Auth detection strategy is data-driven via a new `authCheck` field in
  each `templates/agents/<id>.json` (see Technical Approach).
- [ ] `cc`: calls `claude auth status` (JSON), reads `loggedIn` field.
- [ ] `gg`: detects `GEMINI_API_KEY` env var OR checks `gemini auth status`
  (if/when that command stabilises); API key presence = authenticated.
- [ ] `cx`: checks `OPENAI_API_KEY` / `OPENAI_BASE_URL` env vars; absence =
  unauthenticated.
- [ ] `op`: calls `opencode providers list` or similar; parses whether any
  provider is configured.
- [ ] `km`: checks `MOONSHOT_API_KEY` env var or `~/.config/kimi/` config.
- [ ] `am`: checks `AMP_API_KEY` env var or `~/.config/amp/` credentials
  file.
- [ ] `cu`: marked ℹ️ "auth managed by Cursor IDE" — no programmatic check.
- [ ] `--fix` for auth: for each unauthenticated agent that has a login
  command, opens a new tmux window running that command (e.g. `claude login`,
  `gemini auth login`) so the user can complete sign-in without leaving the
  terminal.

### Model Availability
- [ ] For agents whose models are invocable from the CLI (cc, gg, cx, op, am),
  doctor shows the configured implement/plan model and whether the CLI accepts
  the `--model` flag.
- [ ] If `ANTHROPIC_API_KEY` / `GEMINI_API_KEY` / `OPENAI_API_KEY` is set,
  doctor notes "API key mode" vs "OAuth mode" so users understand their quota
  context (relevant to rate-limit failures).
- [ ] Existing "Template metadata present" row is replaced by this richer row.

### Terminal App Check
- [ ] Reads `terminalApp` from `~/.aigon/config.json` (falls back to
  platform default: `apple-terminal` on macOS, `null` on Linux).
- [ ] On macOS: verifies the corresponding `.app` bundle exists in
  `/Applications/` or `/System/Applications/`. Mapping lives in
  `terminal-adapters.js` alongside the existing adapter definitions.
- [ ] Reports ✅ installed, ❌ not found (with install hint), or ℹ️ not
  configured (auto-detect mode).
- [ ] `--fix` for not-found: prints the install hint and offers to run
  `aigon config set terminalApp <id>` to pick a different installed app.

### Multi-Repo Version Sweep
- [ ] Reads all registered repos from `~/.aigon/ports.json` (filtering out
  worktree paths containing `/.aigon/worktrees/`).
- [ ] For each repo, reads `.aigon/version` and compares to the running aigon
  version.
- [ ] Reports a table: repo name, path, installed version, status
  (✅ current / ⚠️ behind / ❌ missing / · not a dir).
- [ ] `--fix` for stale repos: runs `aigon apply` in each stale directory,
  same behaviour as if the user had `cd`'d in and run it manually.

### tmux Liveness Check
- [ ] In addition to "tmux is installed", runs `tmux list-sessions` to check
  whether the tmux server is actually responding.
- [ ] Reports ✅ server running (N sessions), ℹ️ server not started (no
  sessions yet — this is normal), or ❌ tmux error (with stderr).
- [ ] `--fix` for tmux error: shows the tmux kill-server + restart
  suggestion.

### Additional checks (bundle with this feature)
- [ ] **Dashboard server health**: calls `GET /api/health` on the server port
  from `~/.aigon/dashboard-runtime.json`; reports running/unhealthy/stopped.
- [ ] **Shell PATH**: verifies `which aigon` resolves and points at the
  expected npm global binary; warns if PATH is incomplete.
- [ ] **git identity**: checks `git config user.name` and `git config
  user.email` are set globally; warns if missing (affects commit attribution).

## Technical Approach

### `authCheck` schema in agent templates

Add a new optional top-level field to each `templates/agents/<id>.json`:

```json
"authCheck": {
  "method": "command",          // "command" | "envVar" | "configFile" | "none"
  "command": "claude auth status",
  "successIndicator": "loggedIn",   // JSON field to read (method=command + JSON output)
  "loginCommand": "claude login",   // command to open for --fix remediation
  "loginHint": "Run claude login"   // human hint if loginCommand is absent
}
```

Supported methods:
- **`command`**: run the command, parse stdout. If `successIndicator` is set,
  parse as JSON and check that field is truthy. Otherwise exit code 0 = auth.
- **`envVar`**: check `process.env[envVarName]`. Present + non-empty = auth.
- **`configFile`**: check `fs.existsSync(expandHome(configFilePath))`.
- **`none`**: emit ℹ️ "auth managed externally" (cu).

Auth check execution timeout: 3 s. Errors are caught and reported as ⚠️
"check failed: <message>" rather than crashing doctor.

### Location of new doctor sections

All new sections are added to `runDoctor()` in
`lib/commands/setup.js`, following the existing "Model Health Check" section.
Order: **Agent Auth** → (existing Model Health) → **Terminal App** →
(existing Proxy Health) → **Multi-Repo Version Sweep** → **tmux Liveness** →
**Dashboard Health** → (existing Signal Health, State Reconciliation, etc.)

### Multi-repo sweep implementation

```js
const ports = readPortsJson();  // ~/.aigon/ports.json
const registered = Object.values(ports)
  .filter(p => !p.path.includes('/.aigon/worktrees/'))
  .filter(p => fs.existsSync(p.path));
const currentVersion = require('../../package.json').version;
for (const entry of registered) {
  const v = readAigonVersion(entry.path); // fs.readFileSync(.aigon/version)
  const status = !v ? 'missing' : v === currentVersion ? 'current' : 'behind';
  // print row
}
if (doFix) {
  for (const stale of stalePaths) spawnSync('aigon', ['apply'], { cwd: stale });
}
```

### Terminal app bundle map

Extend `terminal-adapters.js` `adapters` array with an `appBundle` field:

```js
{ id: 'iterm2', appBundle: 'iTerm.app', ... }
{ id: 'warp',   appBundle: 'Warp.app',  ... }
{ id: 'ghostty', appBundle: 'Ghostty.app', ... }
```

Doctor calls `getAdapter(terminalId).appBundle` then checks
`/Applications/<bundle>` and `/System/Applications/<bundle>`.

### `--fix` remediation summary

`--fix` already exists; extend its scope to cover the new checks:

| Check | Fix action |
|---|---|
| Agent unauthenticated (has loginCommand) | `tmux new-window "<loginCommand>"` |
| Terminal app not installed | Print install hint; offer `aigon config set terminalApp` |
| Stale repo version | `aigon apply` in that repo (sync, stdio inherited) |
| tmux error | Print `tmux kill-server && tmux new-session` hint |

A new `--auth-only` flag runs just the Agent Auth section (faster for CI /
daily startup hooks).

## Dependencies

- No new npm dependencies.
- `templates/agents/*.json` schema addition is backwards-compatible (field
  is optional; missing = treat as `method: "none"`).
- `terminal-adapters.js` `appBundle` addition is purely additive.

## Out of Scope

- Live model API probe (sending a real inference request to test quota). That
  belongs in a separate "model smoke-test" command — too slow for doctor.
- Cross-platform (Linux) terminal app check beyond what already exists in the
  Linux section.
- Gemini `auth status` subcommand (not stable as of this writing); only
  API-key env var is checked for `gg`.
- Auto-updating the CLI itself (`npm update -g @senlabsai/aigon`) as part of
  `--fix` — too destructive without explicit consent.

## Open Questions

- **Gemini auth detection**: `GEMINI_API_KEY` covers API-key mode but misses
  OAuth (browser-based) sessions. Is there a `gemini auth status` JSON command
  we can rely on? If not, we could check for `~/.gemini/` credentials dir.
- **Amp auth**: confirm correct env var / config path for Amp session
  detection.
- **`--fix` tmux window behaviour**: open in the current session, or create a
  named session per agent? Agent sessions normally use a naming convention —
  clarify with user.

## Related

- Research: none
- Set: none
