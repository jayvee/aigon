# Research Findings: TUI Onboarding Wizard Frameworks

**Agent:** OpenCode (op)
**Research ID:** 39
**Date:** 2026-04-24

---

## Key Findings

### 1. Library Comparison — Quantitative

All six candidate libraries evaluated with actual data:

| Library | Version | Minified | Gzipped | Dependencies | Weekly Downloads | Last Release | GitHub Stars |
|---|---|---|---|---|---|---|---|
| `@clack/prompts` | 1.2.0 | ~48 KB | ~13 KB | 3 (core + sisteransi) | ~180K | Mar 2026 | 7.7K |
| `@inquirer/prompts` | 8.4.2 | ~375 KB | ~195 KB | 10+ (iconv-lite, chardet…) | ~4.5M | Apr 2026 | 21.5K |
| `prompts` (terkelg) | 2.4.2 | ~82 KB | ~20 KB | 2 (kleur, sisteransi) | ~12M | Oct 2021 | 9.3K |
| `enquirer` | 2.4.1 | ~69 KB | ~21 KB | 1 (ansi-colors) | ~3.5M | 3 years ago | 6.3K |
| `ink` + React | 5.x + 19.x | ~350 KB+ | ~80 KB+ | React + yoga-layout + many | ~1.2M | Active | 37.9K |
| `blessed` | 0.1.81 | ~267 KB | ~77 KB | 0 | ~1.8M | Stale | 11K |

**Startup latency:** `enquirer` loads in ~4ms vs `inquirer`'s ~287ms (from enquirer's own benchmarks). `@clack/prompts` is comparable to enquirer. For a global CLI that must feel instant on `aigon setup`, this matters. `ink`'s React reconciler + Yoga layout engine adds measurable cold-start overhead.

**Bundlephobia detail on `@inquirer/prompts`:** The 195 KB gzip is dominated by `iconv-lite` (295 KB min) and `chardet` (37 KB), both pulled in solely by the `editor` prompt. If you only use `select`, `confirm`, `input`, `checkbox`, `password`, the actual per-prompt packages (`@inquirer/select`, `@inquirer/confirm`, etc.) are ~15 KB gzip each — but the unified `@inquirer/prompts` entry point pulls everything.

### 2. Who Uses What — Primary Source Verification

Verified by checking actual `package.json` files in GitHub repos:

| CLI Tool | Library | Evidence |
|---|---|---|
| **SvelteKit (`sv`)** | `@clack/prompts` v1.0.0 | `packages/sv/package.json` — Rich Harris migrated explicitly (PR #9219) |
| **Astro (`create-astro`)** | `@clack/prompts` v1.1.0 + `ci-info` | `packages/astro/package.json` |
| **create-t3-app** | `@clack/prompts` v0.6.3 + `@clack/core` v0.3.4 | `cli/package.json` |
| **Vercel CLI** | `@inquirer/prompts` | `packages/cli/package.json` — uses select, confirm, expand, search, checkbox, input, password |
| **create-next-app** | `prompts` (terkelg) v2.4.2 + `ci-info` | `packages/create-next-app/package.json` |
| **create-react-app** | `prompts` (terkelg) v2.4.2 | `packages/create-react-app/package.json` |
| **Gemini CLI** | `ink` (custom fork) | `package.json` — full React-based TUI, not just prompts |
| **Railway CLI** | Go (not Node.js) | Native binary via `@napi-rs/triples` |

**Trend:** New tools (2024+) converge on `@clack/prompts`. Legacy tools (2019–2022) use `prompts` or `inquirer`. Vercel CLI is the major holdout on `@inquirer/prompts`, likely due to its complex prompt needs (search, expand, editor) and large existing codebase.

### 3. Best-in-Class Onboarding Wizards — Detailed Analysis

#### 3a. rustup (Rust)
The gold standard for "detect → offer → install → verify" flows:
- **Interactive mode:** `curl ... | sh` presents 3 options: 1) Install with defaults, 2) Customize, 3) Cancel
- **Non-interactive:** `curl ... | sh -s -- -y` applies defaults
- **Prerequisite detection:** Checks for C compiler; on Windows, offers to install Visual Studio Build Tools
- **Idempotent:** `rustup update` checks existing installation and updates in-place
- **State:** `~/.rustup/` and `~/.cargo/` — all toolchain state is file-based
- **Post-install:** Adds `source $HOME/.cargo/env` to shell profile with confirmation
- Source: https://rustup.rs

#### 3b. create-next-app
Best example of "sensible defaults + escape hatches":
- **Auto-detection:** Reads `package.json` for framework, directory name for project name
- **Default branch:** "Would you like to use the recommended Next.js defaults?" — one Enter for happy path
- **Every question has a flag:** `--ts`, `--eslint`, `--tailwind`, `--app`, `--src-dir`, `--import-alias`
- **CI:** Uses `ci-info` to auto-accept defaults when `CI=true`
- **Preference memory:** Uses `conf` package to persist package manager choice across runs
- **Atomic:** On failure, cleans up partially-created directory
- **Non-interactive detection:** Added explicit check after bug reports about hanging in CI (discussion #91169)
- Source: https://github.com/vercel/next.js/tree/canary/packages/create-next-app

#### 3c. create-astro (Astro)
Best example of clack wizard aesthetics:
- `intro()` banner with ASCII art logo
- Template gallery with live previews
- `spinner()` during template download
- `note()` blocks for inline guidance between steps
- `outro()` with "Next steps" summary
- `--template`, `--install`, `--no-install`, `--git`, `--no-git`, `--typescript`, `--yes` flags
- Source: https://github.com/withastro/astro

#### 3d. Vercel CLI
Best example of auth flow in a wizard:
- `vercel login` → opens browser for OAuth → falls back to email verification
- `vercel link` → interactive project search with fuzzy matching
- State persisted in `.vercel/` — re-running reuses existing config
- `VERCEL_TOKEN` env var for CI
- Source: https://github.com/vercel/vercel

#### 3e. WorkOS CLI (AuthKit installer, 2026)
Closest analogue to Aigon's needs — framework-aware AI installer:
- Detect framework → install package → scaffold routes → set env vars → run build to verify
- Exposes `install`, `doctor`, `env`, `skills` subcommands
- Persists progress to state file; `--resume` picks up where left off
- Source: https://github.com/workos/cli

### 4. Inline Install Patterns — Aigon-Specific

For each prerequisite Aigon needs, here are the concrete detect/install/verify commands:

| Prerequisite | Detect | Install Command | Verify | Auto-installable? |
|---|---|---|---|---|
| Node.js ≥18 | `node --version` | `brew install node@20` / `nvm install 20` | `node --version` | Partial — brew/nvm only |
| Git | `git --version` | `brew install git` / `apt install git` | `git --version` | Yes (brew/apt) |
| tmux | `tmux -V` | `brew install tmux` / `apt install tmux` | `tmux -V` | Yes |
| gh (GitHub CLI) | `gh --version` | `brew install gh` | `gh --version` | Yes (optional) |
| Claude Code | `claude --version` | `npm i -g @anthropic-ai/claude-code` | `claude --version` | Yes |
| Gemini CLI | `gemini --version` | `npm i -g @anthropic-ai/gemini-cli` or `npx @anthropic-ai/gemini-cli` | `gemini --version` | Yes |
| Codex | `codex --version` | `npm i -g @openai/codex` | `codex --version` | Yes |
| Cursor | Check `.cursor/` or `which cursor` | Download from cursor.com | `which cursor` | No — must download |
| Caddy | `caddy version` | `brew install caddy` | `caddy version` | Yes (optional) |

**Recommended pattern (from rustup/create-astro):**

```
1. spinner("Checking for git…")
2. If found: note("✓ git vX.Y found")
3. If missing: confirm("Git is required. Install via brew?", { default: true })
4. If yes: spinner("Installing git…") → execSync("brew install git")
5. Re-detect: if still missing, note("⚠ Could not install git. Run: brew install git")
6. Continue to next step (don't abort)
```

**Critical UX rule:** Never shell out silently. Always show the exact command before running it. Always offer "Skip" as an alternative. Never abort the wizard on a single prerequisite failure — let the user continue and fix later.

### 5. Non-Interactive / CI Handling — Specific Implementation

Three layers of protection, ordered by specificity:

**Layer 1: TTY detection**
```js
import isInteractive from 'is-interactive';
if (!isInteractive()) { /* apply defaults, skip prompts */ }
```
`is-interactive` (sindresorhus) checks `process.stdin.isTTY` AND `process.env.CI` AND `process.env.TERM !== 'dumb'`. More robust than checking `process.stdout.isTTY` alone. Size: 0.3 KB gzip.

**Layer 2: `--yes` flag**
```js
const useDefaults = args.includes('--yes') || args.includes('-y');
```
Convention: npm, Vercel, create-next-app, rustup all use `-y`/`--yes`. Aigon should match.

**Layer 3: Per-option CLI flags**
```js
aigon setup --yes                           # all defaults
aigon setup --agent cc,gg                   # specific agents
aigon setup --terminal warp                 # skip terminal prompt
aigon setup --no-install-agents             # skip agent install
aigon setup --non-interactive               # explicit CI mode
```

**When non-interactive + no `--yes` + no per-option flags:** exit 1 with a clear message:
```
Aigon setup requires an interactive terminal.
Run with --yes to accept defaults, or provide flags:
  aigon setup --agent cc --terminal warp
```

**How each library handles CI:**
- `@clack/prompts`: No built-in CI detection. Requires `settings.input`/`settings.output` stream overrides or pre-check by consuming tool. All major users (Astro, SvelteKit) wrap clack calls with `isInteractive()` guard.
- `@inquirer/prompts`: Same — no CI detection. Errors in non-TTY. Users must redirect `/dev/tty` or wrap with `isCI` checks.
- `prompts` (terkelg): Has `prompts.inject()` (test-only) and `prompts.override()` (production) for programmatic answers. Most flexible for CI but documented as secondary.

### 6. Right Scope for Aigon's Wizard

Comparing with peer tools:

| Tool | Prereq Check | Agent Install | Config | Project Init | Server Start |
|---|---|---|---|---|---|
| Vercel CLI | No | No (auth only) | Yes | Yes (deploy) | No |
| create-next-app | Yes (node) | No | No | Yes | No |
| rustup | Yes (C compiler) | Yes (toolchain) | Yes | No | No |
| WorkOS CLI | Yes | Yes (packages) | Yes | Yes | No |
| **Aigon (proposed)** | **Yes** | **Yes** | **Yes** | **Yes** | **No** |

**Recommended scope (5 steps, in order):**

1. **Welcome + Prerequisites** — Detect Node, git, tmux. Offer inline install. Skip what's found.
2. **Terminal Preference** — Existing `global-setup` question, extended to Linux (detect terminal from `$TERM_PROGRAM` env var, offer Warp/iTerm2/kitty/Terminal.app choices).
3. **Agent Selection + Install** — Multiselect from agent registry. For each selected: detect binary → offer install if missing → install under spinner → verify. Then run `aigon install-agent <agents>` inline.
4. **Project Init** — Offer to run `aigon init` in current directory. Skip if `.aigon/` already exists.
5. **Handoff** — Print summary of what was configured. Show "Next steps" with `aigon server start`. Do NOT auto-start the server (it blocks the terminal).

**What NOT to include:**
- Server start — blocking, the user should explore the CLI first
- Agent configuration (models, effort) — too advanced for first run; `aigon config models` exists for this
- Dashboard setup — the server command handles this
- Pro setup — separate concern

### 7. Bundle Size / Startup Latency — `npm install -g` Impact

The dominant cost of `npm install -g @aigon/cli` is npm's own resolver + network I/O, not the JS payload. Current Aigon has exactly one runtime dependency (`xstate`). Adding `@clack/prompts` + `picocolors` adds:

- `@clack/prompts`: 13 KB gzip
- `@clack/core`: ~5 KB gzip (shared dep)
- `sisteransi`: 0.8 KB gzip
- `picocolors`: 2.5 KB gzip

**Total: ~21 KB gzip additional.** This is negligible — less than 1% of a typical global npm install.

For comparison:
- Adding `@inquirer/prompts` would add ~200 KB gzip (10x more)
- Adding `ink` + React would add ~80 KB gzip plus React startup overhead

**Startup latency:** `@clack/prompts` loads lazily (only imported when wizard runs). Since the wizard only runs on `aigon setup` / first-run, the import cost is not paid on every `aigon` invocation. This is critical — the main CLI dispatch must stay fast.

**Implementation note:** Use dynamic import for the wizard module:
```js
// In aigon-cli.js or setup command:
if (needsOnboarding) {
  const { runOnboarding } = await import('./lib/onboarding/wizard.js');
  await runOnboarding();
}
```
This keeps the wizard's ~21 KB out of the main CLI hot path.

### 8. Resumable / Idempotent Wizard Pattern

Three patterns observed in the wild:

**Pattern A: Config File as Checkpoint** (Vercel, Railway)
- Wizard writes choices to `~/.aigon/config.json` or `~/.aigon/onboarding-state.json` after each step
- Re-running reads config and skips completed steps
- Simple, reliable, already fits Aigon's config infrastructure

**Pattern B: All-or-Nothing** (create-next-app, create-t3-app)
- No intermediate state; on failure, clean up and re-run from scratch
- Works for fast scaffolding (< 30 seconds) but poor UX for longer flows

**Pattern C: Step Markers with Resume** (rustup, WorkOS CLI)
- Each step writes a durable marker (file or DB entry)
- `--resume` flag starts from first incomplete step
- Most sophisticated; best UX for multi-minute flows

**Recommendation for Aigon: Pattern A with resume.**

Aigon's setup involves real async work (agent CLI installs, `aigon init`, `install-agent`) that can take 30–60 seconds. Pattern B is unacceptable. Pattern C is over-engineered for 5 steps. Pattern A hits the sweet spot:

```js
// ~/.aigon/onboarding-state.json
{
  "version": 1,
  "steps": {
    "prerequisites": { "completed": true, "at": "2026-04-24T..." },
    "terminal":      { "completed": true, "value": "warp" },
    "agents":        { "completed": false },  // resume here
    "projectInit":   { "completed": false },
    "handoff":       { "completed": false }
  }
}
```

- Each step marks itself complete *after* its effects are committed
- Re-running `aigon setup` (or `aigon setup --resume`) reads this file, skips completed steps
- `aigon setup --force` ignores the state file and re-runs everything
- After all steps complete, the state file is deleted (wizard is done)
- The `global-setup` postinstall script remains for non-interactive prerequisite checks only

### 9. `@clack/prompts` vs `@inquirer/prompts` — API Depth Comparison

For Aigon's specific needs (sequential wizard with select, confirm, multiselect, text input, spinners):

| Feature | `@clack/prompts` | `@inquirer/prompts` |
|---|---|---|
| Select (single) | `select()` | `select()` |
| Multiselect | `multiselect()` | `checkbox()` |
| Confirm | `confirm()` | `confirm()` |
| Text input | `text()` | `input()` |
| Password | `text({ type: 'password' })` | `password()` |
| Spinner | `spinner()` — built-in | No built-in — need `ora` or `cli-spinners` |
| Step grouping | `group()` — built-in | No equivalent — manual Promise chains |
| Intro/outro banners | `intro()` / `outro()` — built-in | No equivalent — manual `console.log` |
| Info blocks | `note()` / `log.info()` | No equivalent |
| Cancel handling | `isCancel(value)` — returns symbol | Promise rejection (throws `ExitPromptError`) |
| CI/TTY override | `settings.input` / `settings.output` | `input`/`output` context options |
| AbortController | No built-in | Built-in `signal: AbortSignal` support |
| i18n | No | `@inquirer/i18n` — 5+ languages |
| Custom prompts | Extend `@clack/core` | Extend `@inquirer/core` + `@inquirer/testing` |
| ESM/CJS | Both | ESM only (v9+) |

**Key insight:** `@clack/prompts` has built-in wizard primitives (`group`, `spinner`, `intro`, `outro`, `note`) that `@inquirer/prompts` lacks. For Aigon's use case — a linear multi-step wizard — clack eliminates the need for 3–4 additional packages (ora for spinners, custom banner logic, step grouping logic). This is why every new `create-*` tool in 2025–2026 chose clack.

**Where inquirer is better:** If Aigon needed i18n, autocomplete search, expand prompts, or the editor prompt — but it doesn't.

## Sources

- https://github.com/bombshell-dev/clack — @clack/prompts repository (7.7K stars, 82 releases, latest Mar 2026)
- https://bomb.sh/docs/clack/basics/getting-started/ — Official clack documentation
- https://github.com/SBoudrias/Inquirer.js — @inquirer/prompts repository (21.5K stars, 317 releases, latest Apr 2026)
- https://github.com/terkelg/prompts — prompts repository (9.3K stars, last release Oct 2021)
- https://github.com/enquirer/enquirer — enquirer repository (6.3K stars, last release 3 years ago)
- https://github.com/vadimdemedes/ink — ink repository (37.9K stars, used by Claude Code, Gemini CLI, Shopify, Cloudflare Wrangler)
- https://github.com/sveltejs/kit/pull/9219 — SvelteKit migration to @clack/prompts (Rich Harris)
- https://github.com/vercel/next.js/discussions/91169 — create-next-app non-interactive detection
- https://github.com/withastro/astro/blob/main/packages/astro/package.json — Astro using @clack/prompts v1.1.0
- https://github.com/vercel/vercel/blob/main/packages/cli/package.json — Vercel CLI using @inquirer/prompts
- https://github.com/vercel/next.js/blob/canary/packages/create-next-app/package.json — create-next-app using prompts (terkelg)
- https://github.com/t3-oss/create-t3-app/blob/main/cli/package.json — create-t3-app using @clack/prompts
- https://rustup.rs — rustup installer (gold standard for detect/install/verify)
- https://github.com/workos/cli — WorkOS CLI (closest analogue to Aigon's needs)
- https://github.com/sindresorhus/is-interactive — TTY detection library
- https://github.com/sindresorhus/conf — Preference persistence (used by create-next-app)
- https://bundlephobia.com/package/@clack/prompts@1.2.0 — Bundle size data for @clack/prompts
- https://github.com/natemoo-re/clack — Original clack (archived; migrated to bombshell-dev/clack)

## Recommendation

**Use `@clack/prompts` + `picocolors` for Aigon's onboarding wizard.**

Rationale:
1. **Right shape:** Clack's `intro`/`group`/`spinner`/`note`/`outro` API is purpose-built for sequential wizards. This eliminates 3–4 glue packages that inquirer would require.
2. **Right size:** 13 KB gzip total vs 195 KB for inquirer. Negligible impact on `npm install -g` time or CLI startup.
3. **Right aesthetic:** The connected-step gutter (◆/◇/│/└) is the visual standard for modern CLI wizards. Every 2025–2026 `create-*` tool uses it.
4. **Industry alignment:** SvelteKit, Astro, create-t3-app all chose clack after evaluating the same alternatives. The maintainer (Nate Moore / bombshell-dev) is active (82 releases, latest Mar 2026).
5. **Lazy-loadable:** Dynamic `import()` keeps the wizard's ~21 KB out of the main CLI dispatch path.
6. **Aigon doesn't need what inquirer uniquely offers:** No i18n, no autocomplete search, no expand prompts, no editor prompts.

**Scope (5 steps):**
1. Welcome + Prerequisites (detect → offer install → verify)
2. Terminal Preference (extend to Linux)
3. Agent Selection + Install (multiselect → install → verify)
4. Project Init (`aigon init` inline)
5. Handoff (summary + next steps)

**Non-negotiables:**
- `is-interactive` guard + `--yes` flag for CI
- Persist progress to `~/.aigon/onboarding-state.json` after each step
- `--resume` to skip completed steps, `--force` to re-run all
- Dynamic import so wizard code is never loaded on non-wizard commands
- Never auto-start the server; print handoff instructions instead
- Every prerequisite failure is non-fatal; offer skip and continue

**Future consideration:** `ink` (React for CLIs) is the right choice only if Aigon later builds a full-screen, stateful TUI (e.g., a live agent monitoring dashboard in the terminal). That is a different product, not onboarding.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|---|---|---|---|
| `onboarding-wizard-clack` | Add `@clack/prompts` + `picocolors` deps; implement 5-step wizard with intro/group/spinner/note/outro, persisted state file, `--yes`/`--resume`/`--force` flags, `is-interactive` TTY guard, and dynamic import | high | none |
| `onboarding-first-run-dispatch` | Detect first-run in `aigon-cli.js` (no `~/.aigon/config.json` or `onboarded: false` flag) and invoke wizard; add `aigon setup` command for re-runs | high | onboarding-wizard-clack |
| `onboarding-prereq-detectors` | Extract prerequisite detection (node, git, tmux, gh, caddy) into `lib/onboarding/detectors.js` with `{ check, install, verify }` contracts so wizard, `aigon doctor`, and `install-agent` share the same logic | high | onboarding-wizard-clack |
| `onboarding-agent-install` | Multiselect + install flow for agent CLIs (cc/gg/cx/cu/op), using the agent registry as the source of install commands and verify probes | high | onboarding-prereq-detectors |
| `onboarding-linux-terminal` | Add Linux terminal detection (from `$TERM_PROGRAM`, `$COLORTERM`, `$TERM`) and terminal preference prompt to the wizard, closing the F334 gap | medium | onboarding-wizard-clack |
