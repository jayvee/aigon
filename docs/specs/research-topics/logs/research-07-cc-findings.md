# Research Findings: auto install

**Agent:** Claude (cc)
**Research ID:** 07
**Date:** 2026-03-02

---

## Key Findings

### 1. Viable Trigger Points for Auto-Install

| Trigger | When It Fires | Agent Coverage | Complexity |
|---------|--------------|----------------|------------|
| **Agent SessionStart hooks** | Agent session begins | Claude Code, Cursor, Gemini CLI (not Codex) | Low |
| **npm `prepare` script** | `npm install` in the project | All (if project has `package.json`) | Low |
| **Shell `chpwd` hook** | User `cd`s into project | All (agent-agnostic) | Medium |
| **direnv `.envrc`** | User enters directory | All (requires direnv installed) | Medium |
| **Git `post-checkout` hook** | `git checkout`/`git switch` | All (requires Husky or manual `.git/hooks/`) | Low |
| **Git `post-merge` hook** | After `git pull`/`git merge` | All | Low |
| **launchd/cron** | Scheduled interval | All (background, macOS-only for launchd) | High |
| **`npx aigon update`** | Manual invocation | All (requires npm) | Low |

**Best option:** Agent SessionStart hooks provide the most targeted trigger — they fire exactly when an agent needs up-to-date command files. Three of four supported agents (Claude Code, Cursor, Gemini CLI) now have `SessionStart` hooks with nearly identical configuration.

### 2. Pull Model: Agent Startup Hooks

All three major agent CLIs now support session-start hooks:

#### Claude Code (`SessionStart`)
- **Docs:** [code.claude.com/docs/en/hooks](https://code.claude.com/docs/en/hooks)
- **Config:** `.claude/settings.json` → `hooks.SessionStart`
- **Matcher values:** `startup`, `resume`, `clear`, `compact`
- **Stdout becomes context** — hook output is injected as context for the agent
- **`CLAUDE_ENV_FILE`** — can persist env vars for the session
- **Cannot block session** — exit code 2 shows stderr but session continues

```json
{
  "hooks": {
    "SessionStart": [
      {
        "matcher": "startup",
        "hooks": [
          {
            "type": "command",
            "command": "aigon check-version --auto-update",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

#### Cursor (`sessionStart`)
- **Docs:** [cursor.com/docs/agent/hooks](https://cursor.com/docs/agent/hooks)
- **Config:** `.cursor/hooks.json` → `hooks.sessionStart`
- **Same JSON stdin/stdout protocol** as Claude Code
- **Beta** (v1.7+, early 2026)
- **Session-scoped env vars** propagate to all subsequent hooks

#### Gemini CLI (`SessionStart`)
- **Docs:** [geminicli.com/docs/hooks/](https://geminicli.com/docs/hooks/)
- **Config:** `.gemini/settings.json` → `hooks.SessionStart`
- **Nearly identical protocol** to Claude Code
- **Also has Extensions system** — could be a secondary distribution channel
- **Security:** Project-level hooks are content-fingerprinted; modifications require re-approval

#### Codex CLI — No hooks
- **Status:** No hook system. [Issue #2109](https://github.com/openai/codex/issues/2109) (449 upvotes) is open; a community [PR #9796](https://github.com/openai/codex/pull/9796) was rejected (no unsolicited features policy).
- **Workarounds:** AGENTS.md instruction, shell wrapper, or `codex exec` non-interactive mode.

### 3. Push Model: `aigon update --all`

**Current state:** Aigon already has a project registry at `~/.aigon/ports.json` (`{ "appId": { basePort, path } }`) used for dev proxy port allocation. This registry tracks all Aigon-enabled projects on the machine.

**Feasibility:** High. A new `aigon update --all` command could:
1. Read `~/.aigon/ports.json` to get all project paths
2. For each project, `cd` into it and run the equivalent of `aigon update`
3. Optionally auto-commit with a conventional message

**Trade-offs:**
- **Pro:** Single command updates everything; no per-project hook setup needed
- **Pro:** Works regardless of which agent is used
- **Con:** Requires the user to remember to run it after upgrading Aigon
- **Con:** Projects may have uncommitted changes or be on feature branches
- **Con:** `ports.json` only tracks projects that have used `dev-server`; not all Aigon projects

**Enhancement needed:** A proper project registry (separate from ports.json) that tracks all Aigon-enabled projects, populated during `aigon update` or `aigon install-agent`.

### 4. Committed vs Ephemeral Generated Files

Researched how 8 tools handle this decision:

| Tool | Config Committed? | Generated Files | Regeneration Trigger |
|------|-------------------|-----------------|---------------------|
| **Husky** | Yes (hook scripts) | Gitignored (`.husky/_/`) | npm `prepare` |
| **ESLint shared configs** | Yes (reference) | In `node_modules/` | npm install |
| **mise/asdf** | Yes (`.tool-versions`) | In `~/.local/share/` | Shell hook on cd |
| **direnv** | Yes (`.envrc`) | N/A (env vars) | Shell prompt hook |
| **Prettier shared** | Yes (reference) | In `node_modules/` | npm install |

**The dominant pattern**: Commit a small, human-readable config file; gitignore the generated runtime files; regenerate via a lifecycle hook.

**For Aigon, three options:**

**Option A — Ephemeral (recommended for new projects):**
- Commit only `.aigon/config.json` and `AGENTS.md` / `CLAUDE.md` (user-edited content outside markers)
- Gitignore `.claude/commands/aigon/`, `.cursor/commands/`, etc.
- Regenerate via SessionStart hook or `prepare` script
- **Pro:** Clean diffs, no merge conflicts in generated files, single source of truth
- **Con:** Commands unavailable until regeneration runs; requires hook/lifecycle setup

**Option B — Committed with staleness detection (current approach, enhanced):**
- Keep committing generated files (current behavior)
- Add a version/hash marker: `<!-- Generated by aigon@2.27.0 -->`
- Version gate warns when committed files are stale
- **Pro:** Clone-and-go; no tooling required for commands to be available
- **Con:** Noisy diffs; merge conflicts; files can drift from templates

**Option C — Hybrid (best of both, recommended):**
- Commit generated files (for clone-and-go)
- SessionStart hook regenerates and auto-stages if changed
- Generated files include version markers for staleness detection
- `.gitattributes` with custom merge driver that regenerates on conflict
- **Pro:** Works without hooks; self-healing with hooks; no manual intervention
- **Con:** Slightly more complex implementation

### 5. Version Pinning

**Where to store the pin:** `.aigon/config.json` (already committed, already used for profile/appId).

```json
{
  "profile": "web",
  "aigon_version": "2.27.0"
}
```

**Pin format:** Start with exact version only. The existing `compareVersions()` function in aigon-cli.js (line 2607) handles equality checks. Semver ranges (`^2.27.0`, `~2.27.0`) add complexity and can be deferred.

**Enforcement flow:**
1. `aigon update` writes current CLI version to `.aigon/config.json` as `aigon_version`
2. On any `aigon` command that writes files: compare pin vs CLI version, warn on mismatch
3. `--force` flag bypasses pin and re-pins to current version

**How other tools handle this:**
- **nvm:** `.nvmrc` with exact version string
- **mise:** `mise.toml` with exact or fuzzy (`node = '22'` matches latest 22.x)
- **Rust:** `rust-toolchain.toml` with channel = version

### 6. Conflict Avoidance During Auto-Update

**Scenario analysis:**

| Scenario | Recommended Behavior |
|----------|---------------------|
| **Uncommitted changes to generated files** | Warn and abort; suggest `aigon update --force` or committing first |
| **Active feature branch** | Warn about branch; proceed if user confirms (generated files should be branch-agnostic) |
| **Merge conflicts in generated files** | Always regenerate; generated files should never be manually resolved |

**Key insight from research:** lint-staged's approach of auto-stashing is elegant but overkill for Aigon. Since generated files are fully derivable from templates, the right strategy is **always regenerate, never manually resolve**. A `.gitattributes` merge driver could automate this:

```
.claude/commands/aigon/** merge=aigon-regenerate
.cursor/commands/** merge=aigon-regenerate
```

### 7. npm/Node Mechanisms

**Global install (current)** is the right default for Aigon because:
- Many target projects are non-Node (iOS, Android, generic)
- Adding `package.json` just for Aigon creates friction in non-Node repos
- Global binary is always in PATH

**devDependency** is viable as an optional path for Node projects:
```json
{
  "devDependencies": { "aigon": "github:jayvee/aigon#v2.27.0" },
  "scripts": { "prepare": "aigon update" }
}
```
This would give automatic regeneration on `npm install` for Node projects.

**npx caveats:** `npx aigon update` uses cached versions (not always latest). Must use `npx aigon@latest update` for guaranteed freshness, but even that has known bugs ([npm/cli#5262](https://github.com/npm/cli/issues/5262)).

### 8. How Other Tools Solve Distribution

**Most applicable patterns for Aigon:**

| Pattern | From | Applicability |
|---------|------|---------------|
| **`prepare` lifecycle script** | Husky | High — automatic on `npm install` (Node projects only) |
| **Shell prompt hook** | mise, direnv | Medium — checks on `cd`, agent-agnostic but requires shell setup |
| **PR-based updates** | Renovate/Dependabot | Low — heavyweight for single-developer workflow |
| **Shared config packages** | ESLint, Prettier | Low — Aigon generates files, not references to packages |
| **Background scheduler** | Homebrew autoupdate | Low — overkill, macOS-only |

### 9. Remote Version Checking

**Best remote source:** `raw.githubusercontent.com/jayvee/aigon/main/package.json`
- Single HTTP GET, parse `JSON.parse(body).version`
- No API authentication required
- ~5000 req/hr IP-based limit
- Faster than `git ls-remote` (which does full ref handshake, 500ms-3s)
- More straightforward than GitHub Releases API

**Runner-up:** GitHub Releases API (`GET /repos/:owner/:repo/releases/latest`)
- Better structured (release notes, assets) but requires creating formal Releases (not just tags)
- 60/hr unauthenticated, 5000/hr with token

### 10. Version Source Abstraction

| Source | Works Offline | Latency | Rate Limits | Best For |
|--------|:------------:|---------|-------------|----------|
| `aigon --version` (local) | Yes | ~0ms | None | "What am I running?" |
| `raw.githubusercontent.com` | No | 200-600ms | ~5000/hr | "What's the latest?" |
| GitHub API Releases | No | 300-1000ms | 60/hr unauth | Structured release info |
| `npm view aigon version` | No | 200-800ms | npm throttle | N/A (Aigon not on npm) |
| `git ls-remote --tags` | No | 500-3000ms | Git protocol | Fallback |

### 11. Caching for GitHub API

**Strategy:** File-based cache with 1-hour TTL at `~/.aigon/version-cache.json`:

```json
{
  "latest_version": "2.27.0",
  "checked_at": "2026-03-02T10:00:00Z",
  "etag": "\"abc123\"",
  "source": "raw.githubusercontent.com"
}
```

**Why 1 hour:** Homebrew uses 5-minute default for `HOMEBREW_AUTO_UPDATE_SECS`; pip uses ~24 hours. 1 hour balances freshness vs network cost for a development tool.

**GitHub conditional requests:** `If-None-Match` with ETags returns 304 without body when unchanged, and **does not count against rate limits** when authenticated ([GitHub docs](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)).

**On network failure:** Silently skip. Degrade gracefully to offline mode — version checking should never block work.

### 12. Minimal Viable Approach

**The "Version Gate + SessionStart Hook" pattern** — two complementary features:

**Part 1 — Version Gate (local, zero-network, ~30 lines):**
1. `aigon update` writes `aigon_version` to `.aigon/config.json`
2. On any file-writing command: compare pin vs CLI version, warn on mismatch
3. Uses existing `compareVersions()` and `loadProjectConfig()` — no new dependencies

**Part 2 — SessionStart Hook (auto-update trigger, ~50 lines):**
1. `aigon install-agent` writes a SessionStart hook into each agent's settings
2. Hook runs `aigon check-version` which compares local CLI vs project pin
3. If outdated: prints a notice that becomes agent context
4. If `--auto-update` flag: runs `aigon update` automatically

**Together:** Every agent session starts by checking if generated files are current. If not, the agent either sees a warning (and can tell the user) or auto-regenerates. Version drift is eliminated with ~80 lines of new code and zero new dependencies.

## Sources

- [Claude Code Hooks Documentation](https://code.claude.com/docs/en/hooks)
- [Claude Code Hooks Blog Post](https://claude.com/blog/how-to-configure-hooks)
- [Cursor Hooks Documentation](https://cursor.com/docs/agent/hooks)
- [Gemini CLI Hooks Documentation](https://geminicli.com/docs/hooks/)
- [Gemini CLI Extensions](https://geminicli.com/docs/extensions/)
- [Codex CLI Issue #2109 - Event Hooks](https://github.com/openai/codex/issues/2109)
- [Husky Documentation](https://typicode.github.io/husky/)
- [lint-staged GitHub](https://github.com/lint-staged/lint-staged)
- [ESLint Shareable Configs](https://eslint.org/docs/latest/extend/shareable-configs)
- [Prettier Sharing Configurations](https://prettier.io/docs/sharing-configurations)
- [direnv](https://direnv.net/)
- [Homebrew autoupdate](https://github.com/DomT4/homebrew-autoupdate)
- [Renovate Documentation](https://docs.renovatebot.com/)
- [Dependabot Documentation](https://docs.github.com/en/code-security/dependabot/dependabot-version-updates)
- [mise Documentation](https://mise.jdx.dev/)
- [asdf Introduction](https://asdf-vm.com/guide/introduction.html)
- [GitHub REST API Rate Limits](https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api)
- [GitHub REST API Best Practices](https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api)
- [npm scripts documentation](https://docs.npmjs.com/cli/v7/using-npm/scripts/)
- [npm cache documentation](https://docs.npmjs.com/cli/v8/commands/npm-cache/)
- [pip caching documentation](https://pip.pypa.io/en/stable/topics/caching/)
- [Cargo Registry Index](https://doc.rust-lang.org/cargo/reference/registry-index.html)
- [VS Code Activation Events](https://code.visualstudio.com/api/references/activation-events)

## Recommendation

### Recommended Approach: Layered Pull Model

I recommend a **three-layer approach**, implemented incrementally:

**Layer 1 — Version Gate (implement first, zero risk):**
- Pin Aigon version in `.aigon/config.json` during `aigon update`
- Warn on version mismatch in any file-writing command
- ~30 lines of code, no new dependencies, no network calls
- Eliminates silent drift — every mismatch is surfaced immediately

**Layer 2 — SessionStart Hooks (implement second, high value):**
- `aigon install-agent` writes SessionStart hooks for Claude Code, Cursor, and Gemini CLI
- Hook runs `aigon check-version` — compares CLI version vs project pin
- Output becomes agent context: "Aigon v2.28.0 available, you have v2.27.0"
- Optional `--auto-update` mode runs `aigon update` automatically
- Codex fallback: AGENTS.md instruction to check version

**Layer 3 — Push Model (implement later, convenience):**
- New `aigon update --all` command reads project registry
- Enhanced project registry (beyond `ports.json`) tracking all Aigon-enabled projects
- Single command to update every project after upgrading Aigon globally
- Auto-commit option with conventional message

**Why pull-first:** The pull model (hooks check on session start) is more reliable than push because:
1. It catches drift even if the user forgets to push
2. It works for projects not yet in the registry
3. It's self-healing — every agent session is a sync opportunity

**Generated files:** Keep committing them (Option C — hybrid). They work clone-and-go, and SessionStart hooks make them self-healing. Add version markers for staleness detection.

**Version checking:** Start local-only (CLI vs pin). Add remote checking (raw.githubusercontent.com with 1-hour cache) as a separate enhancement when/if Aigon is consumed via npx or by users who don't develop Aigon locally.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| version-gate | Pin Aigon version in `.aigon/config.json` and warn on mismatch during file-writing commands | high | none |
| session-start-hooks | Write SessionStart hooks for Claude Code, Cursor, and Gemini CLI during `install-agent` that run `aigon check-version` | high | version-gate |
| check-version-command | New `aigon check-version` command that compares CLI version vs project pin and outputs status for hook consumption | high | version-gate |
| update-all-command | New `aigon update --all` command that iterates over registered projects and runs update in each | medium | project-registry |
| project-registry | Enhanced global registry tracking all Aigon-enabled projects (beyond ports.json) | medium | none |
| remote-version-check | Fetch latest version from raw.githubusercontent.com with 1-hour TTL cache at `~/.aigon/version-cache.json` | medium | check-version-command |
| generated-file-markers | Add `<!-- Generated by aigon@X.Y.Z -->` markers to generated files for staleness detection | low | none |
| gitattributes-merge-driver | Custom `.gitattributes` merge driver that regenerates Aigon files on merge conflict | low | none |
| codex-version-fallback | Add version check instruction to Codex AGENTS.md/prompt.md as fallback for missing hooks | low | version-gate |
| ephemeral-mode | Optional mode where generated command files are gitignored and always regenerated at session start | low | session-start-hooks |
