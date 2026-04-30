# Research Findings: tui onboarding wizard frameworks

**Agent:** Claude (cc)
**Research ID:** 39
**Date:** 2026-04-24

---

## Key Findings

### The candidate landscape

Five libraries cover the practical Node.js TUI prompt space. Two more (`ink`, `blessed`) solve a different problem and are called out for completeness but are not candidates for Aigon's wizard.

| Library | Shape | Size (approx.) | Notable users | Fit for Aigon |
|---|---|---|---|---|
| `@clack/prompts` | High-level, opinionated, pre-styled prompts + spinners + grouped steps | ~4 KB gzipped (core + prompts) | `create-svelte` (merged via PR #9219 in SvelteKit's `create-svelte`), `create-astro`, `create-next-app` family, many indie CLIs; 6,400+ dependents on npm | **Strong** — wizard-shaped API (`intro`, `group`, `outro`, `note`, `spinner`) maps directly to Aigon's onboarding flow with almost no glue code |
| `@inquirer/prompts` | Modular prompts, v9+ ESM rewrite, plugin ecosystem | Larger — each prompt is its own package; rendering engine is heavier | Legacy dominant; still powers AWS, Azure, and many internal CLIs carried forward from Inquirer.js | **Weaker** — strong if you need custom prompt types (autocomplete, date), i18n, CJS. Aigon needs none of these |
| `prompts` | Single dep, minimal API, imperative | Smallest footprint of the Inquirer-alternatives | ~43M weekly downloads; used by older `create-*` tools, `vite` historically | Good fallback — but visual quality is flat (no connected step indicator), no grouped wizard primitive |
| `enquirer` | Classes-based, themeable | Medium | Used in some Yeoman-era tooling | Aging; not a real contender for a 2026 greenfield wizard |
| `@clack/core` | Low-level primitives under `@clack/prompts` | Tiny | — | Only relevant if we need a custom prompt the high-level package doesn't expose |
| `ink` (React) | Full component framework for CLIs | Heavy (React + reconciler) | Gatsby, GitHub Copilot CLI, Prisma, Shopify CLI | **Overkill for a linear wizard.** Right answer for full-screen, stateful TUIs with panels and live data |
| `blessed` / `neo-blessed` | Imperative terminal UI | Heavy | Legacy tooling | Not a fit for a modern setup flow |

### What high-quality onboarding wizards actually do (2025–2026)

1. **`create-svelte` (SvelteKit) — clack-based.** Rich Harris explicitly migrated to `@clack/prompts` "to make the create-svelte experience slightly more polished" (PR #9219, follow-up #9346). Connected step flow, consistent spacing, colored gutter, `note()` blocks for inline guidance.
2. **`create-astro` — clack-based.** Interactive by default; `--yes`/`--no` flags make it non-interactive. Uses `spinner()` during template download.
3. **`create-next-app` — custom but clack-flavored prompts.** April 21, 2026 docs update added: "Would you like to use the recommended Next.js defaults?" as a first-class branch with "Yes / Reuse previous / Customize" — a very clean pattern for wizards that want one-key happy path plus a detailed branch. Also detects non-interactive environments and fails fast (vercel/next.js discussion #91169).
4. **Gemini CLI.** On first run: pick color theme → authenticate with Google in browser → save to `settings.json`. Lightweight because the CLI itself persists the state in `~/.gemini/`.
5. **WorkOS CLI (AuthKit installer, 2026).** Framework-aware AI installer: detect framework → install package → scaffold routes → set env vars → run build to verify. Exposes `install`, `doctor`, `env`, `skills` subcommands. This is the closest analogue to what Aigon needs: **detect → install → configure → verify**.

### Common patterns the best wizards share

- **Single visually-connected flow**, not a sequence of disconnected prompts. `clack`'s side gutter with `◆/◇/│/└` is the de-facto look.
- **`intro` / `outro` headers** that frame the session so it feels like a wizard rather than a script.
- **`note()` blocks** for "here's what I'm about to do" and "here's where this was saved."
- **`group()` with the ability to cancel** at any step, returning a single typed object of answers.
- **`spinner()` around async work** (downloads, shell-outs, detection).
- **Non-interactive escape hatch**: `--yes` flag, env var (`CI=1`), or auto-skip when `!process.stdin.isTTY`. `is-interactive` is the standard helper (checks TTY + CI env vars + dumb terminals).
- **Idempotence via a persisted state file.** Both the WorkOS CLI and Cass index pattern persist progress to `~/.config/<tool>/state.json` or `~/.cache/<tool>/setup_state.json` so `--resume` can pick up where it left off.

### Inline "detect → install → verify" pattern

The shape that works across the surveyed tools:

1. Detect with a `spinner()`; render `✓ found vX.Y` or `✗ missing`.
2. If missing, show a `confirm()` with the exact command we'd run ("Install `claude-code` via `npm i -g @anthropic-ai/claude-code`?") — never shell out silently.
3. Run the install under a new `spinner()`; capture stdout/stderr for the error branch.
4. Re-run the detector to verify; if still missing, print actionable remediation and move on (don't abort the wizard).
5. Record completion in the state file before moving to the next step — so interrupted wizards resume past this step on next run.

### Non-interactive (CI/headless) handling

Three rules from the survey:

- `is-interactive` (sindresorhus) is the right TTY check — it handles CI env vars and dumb terminals that vanilla `process.stdin.isTTY` misses.
- Fail *fast* with a clear message when interactivity is required and missing (create-next-app discussion #91169 is the canonical example — they added explicit non-interactive detection after bug reports).
- Provide a `--yes` / `--defaults` flag that applies sensible defaults and writes the state file the same way the interactive path would, so `--resume` works identically.

### Bundle size / startup latency

- `@clack/prompts` + `@clack/core` is ~4 KB gzipped and imports lazily; startup impact on `aigon` is negligible (well under a frame).
- `@inquirer/prompts` ships per-prompt sub-packages, so you only pay for what you import, but the baseline render engine is heavier and ESM-only (v9+) — fine for Aigon which is Node-only, but heavier than clack.
- `ink` would add ~200 KB of React + reconciler + yoga-layout to the install footprint. That's the wrong tradeoff for a wizard that runs once.
- The dominant latency cost on `npm i -g @senlabs/aigon` comes from *other* deps (npm resolver, install itself); the prompt library choice is a rounding error.

## Sources

- [@clack/prompts on npm](https://www.npmjs.com/package/@clack/prompts)
- [Bombshell docs for @clack/prompts](https://bomb.sh/docs/clack/packages/prompts/)
- [Clack homepage](https://www.clack.cc/)
- [@clack/prompts: The Modern Alternative to Inquirer.js (DEV)](https://dev.to/chengyixu/clackprompts-the-modern-alternative-to-inquirerjs-1ohb)
- [Elevate Your CLI Tools with @clack/prompts (blacksrc.com)](https://www.blacksrc.com/blog/elevate-your-cli-tools-with-clack-prompts)
- [Building CLIs with Clack (James Perkins)](https://www.jamesperkins.dev/post/cli-with-clack)
- [@inquirer/prompts on npm](https://www.npmjs.com/package/@inquirer/prompts)
- [SvelteKit PR #9219 — feat: use @clack/prompts](https://github.com/sveltejs/kit/pull/9219)
- [SvelteKit PR #9346 — update @clack/prompts](https://github.com/sveltejs/kit/pull/9346)
- [create-astro README (withastro/astro)](https://github.com/withastro/astro/blob/main/packages/create-astro/README.md)
- [create-next-app CLI reference (Next.js docs, updated 2026-04-21)](https://nextjs.org/docs/app/api-reference/cli/create-next-app)
- [create-next-app: detect non-interactive environments (vercel/next.js #91169)](https://github.com/vercel/next.js/discussions/91169)
- [Gemini CLI Getting Started](https://geminicli.com/docs/get-started/)
- [WorkOS CLI (AI-powered AuthKit installer)](https://github.com/workos/cli)
- [Node.js CLI Apps Best Practices (lirantal)](https://github.com/lirantal/nodejs-cli-apps-best-practices)
- [sindresorhus/is-interactive](https://github.com/sindresorhus/is-interactive)
- [Ink — React for CLIs](https://github.com/vadimdemedes/ink)

## Recommendation

**Use `@clack/prompts` for Aigon's onboarding wizard.** It is the right shape, right size, right aesthetic, and right level of abstraction — everything `create-svelte`, `create-astro`, and the broader 2026 generation of `create-*` tools landed on after trying the alternatives. Aigon's wizard is a linear, branching, prompt-driven flow with inline async work (detect → install → verify), and `@clack/prompts`' `intro` / `group` / `spinner` / `note` / `outro` primitives map to that flow directly.

Use `ink` only if we later want a full-screen stateful dashboard TUI (e.g. a live view of running agents in a single pane). That is a different product, not onboarding.

**Scope for the wizard (in order):**

1. **Prerequisites** — Node version, git, `gh` (optional), tmux, terminal detection. Detect with spinners, offer inline install for the ones we can safely install (`brew install tmux`, `npm i -g ...`), skip gracefully otherwise.
2. **Terminal app preference** — existing `global-setup` step; move it here.
3. **Agent CLI selection + install** — multiselect of supported agents (cc/gg/cx/cu/op), then run `npm i -g <pkg>` for the selected ones under a spinner, then verify each binary is on `PATH`.
4. **Project init** — offer to run `aigon init` in the current directory (or skip for later).
5. **Server start** — offer to start `aigon server` now (skippable).

**Non-negotiables:**

- `--yes` flag + `is-interactive` guard. Non-TTY runs apply defaults, write the state file, and exit 0.
- Persist progress to `~/.aigon/onboarding-state.json` keyed by step id. Re-running the wizard (or running `aigon setup --resume`) skips completed steps and starts at the first incomplete one.
- Every step is idempotent: detect-before-install, verify-after-install, never assume first-run. Failures inside a step print the underlying command output and let the user continue or abort.
- The wizard is invoked by a first-run detection in `aigon-cli.js` (absence of `~/.aigon/config.json` or an `onboarded: false` flag) **and** a direct `aigon onboarding` / `aigon setup` command for re-runs. No postinstall script — npm global postinstall is unreliable and running an interactive wizard inside `npm i -g` is a UX trap.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| onboarding-wizard-clack | Build the first-run `aigon onboarding` wizard on `@clack/prompts` with the five-step flow above, persisted state file, `--yes` / `--resume` flags, and `is-interactive` non-TTY guard | high | none |
| onboarding-first-run-dispatcher | Detect first-run in `aigon-cli.js` (no `~/.aigon/config.json` or `onboarded: false`) and invoke the wizard; add `aigon setup --resume` for re-runs | high | onboarding-wizard-clack |
| onboarding-prereq-detectors | Extract prerequisite detection (node, git, gh, tmux, terminal) into `lib/onboarding/detectors.js` with `{ check, install, verify }` contracts so the wizard, `aigon doctor`, and `install-agent` share the same source of truth | high | onboarding-wizard-clack |
| onboarding-agent-install-step | Multiselect + install flow for agent CLIs (cc/gg/cx/cu/op), using the agent registry (`templates/agents/*.json`) as the source of install commands and verify probes | high | onboarding-prereq-detectors |
| onboarding-non-interactive-defaults | `--yes` flag and CI-safe defaults path that writes the same state file the interactive wizard would, so `--resume` and re-runs behave identically | medium | onboarding-wizard-clack |
