---
complexity: medium
---

# Feature: terminal-adapter-registry

## Summary

Adding a new `terminalApp` option (e.g. `ghostty`) today requires edits in **7 separate places**: `lib/terminal-adapters.js` (adapter entry), `lib/global-config-migration.js` (`canonicalizeTerminalApp` whitelist), `lib/onboarding/terminal.js` (clack picker), `lib/dashboard-server.js` (enum options), `lib/commands/infra.js` (help text x2), `lib/worktree.js` (display-name map), and the migration tests. This feature consolidates adapter metadata onto the adapter objects themselves in `lib/terminal-adapters.js` and exposes a small registry API, so adding a new terminal becomes a single-file change (register one adapter, done).

## User Stories

- [ ] As a maintainer, I can add a new terminal (e.g. `ghostty`) by adding **one adapter object** to `lib/terminal-adapters.js` and nothing else — no dashboard enum edit, no picker edit, no help-text edit, no canonicaliser edit.
- [ ] As a user, the dashboard **Terminal app** dropdown, the `aigon init` onboarding picker, and `aigon config set --global terminalApp …` validation all reflect the same set of supported terminals automatically.
- [ ] As a user upgrading from a legacy config, the existing `'terminal' → 'apple-terminal'` alias keeps working (migration is not regressed).

## Acceptance Criteria

- [ ] `lib/terminal-adapters.js` exports a registry API: at minimum `getTerminalIds({ platform })`, `getPickerOptions({ platform })`, `getDashboardOptions()`, `getDisplayName(id)`, `canonicalize(value)`, `isValidId(id)`. Exact names TBD during implementation — constraint is that **all consumers import from this one module**.
- [ ] Each macOS adapter object carries its own metadata: `id`, `displayName`, `pickerLabel`, `description` (dashboard-facing), `platforms`, optional `aliases` (for legacy inputs like `'terminal' → 'apple-terminal'`), optional `hiddenFromPicker` (for Linux auto-detected entries).
- [ ] `lib/global-config-migration.js::canonicalizeTerminalApp` delegates to the registry — no hardcoded `id === 'warp' || 'iterm2' || 'apple-terminal'` list. The `'terminal' → 'apple-terminal'` alias is preserved by the Terminal.app adapter's `aliases` field, not a hardcoded branch.
- [ ] `lib/onboarding/terminal.js::selectTerminal` builds the clack options from the registry (filtered to macOS picker-visible adapters).
- [ ] `lib/dashboard-server.js` `terminalApp` settings-schema entry builds its `options` array from the registry; the `description` also comes from the registry (or stays generic, if consensus is that per-terminal descriptions aren't needed).
- [ ] `lib/worktree.js::openSingleWorktree` builds the display-name map from the registry (no literal `{ warp: 'Warp', iterm2: 'iTerm2', ... }`).
- [ ] `lib/commands/infra.js` help text for `aigon init` lists supported terminals from the registry (the two `console.log` lines listing terminal values must be generated, not hand-typed).
- [ ] **Regression test (new):** a test in `tests/integration/` (or `tests/unit/terminal-adapter-registry.test.js`) asserts that registering a hypothetical test adapter causes it to appear in all six surfaces — picker options, dashboard options, display-name lookup, canonicalize acceptance, migration test whitelist, help-text listing. Prevents future drift.
- [ ] Existing `tests/integration/global-config-migration.test.js` still passes unchanged. The legacy `'terminal' → 'apple-terminal'` migration path still works.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.
- [ ] `node -c aigon-cli.js` passes. `aigon server restart` is run once after `lib/*.js` edits.
- [ ] A short section added to `AGENTS.md` (or `docs/architecture.md` — whichever already documents terminal handling) pointing contributors at the registry as the single source of truth.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if the new registry test requires it.
- May skip `npm run test:ui` — this feature touches `lib/` only, no dashboard assets.

## Technical Approach

**Current state (mapped from code):**

| Touchpoint | File | What's hardcoded |
|---|---|---|
| Adapter | `lib/terminal-adapters.js` | `adapters[]` — already a list, but no metadata besides `name`/`detect`/`launch`. |
| Canonicalize | `lib/global-config-migration.js:37-41` | `'warp' \|\| 'iterm2' \|\| 'apple-terminal'` whitelist + `'terminal' → 'apple-terminal'` alias |
| Onboarding picker | `lib/onboarding/terminal.js:13-21` | `clack.select` options literal |
| Dashboard enum | `lib/dashboard-server.js:648-652` | `options: ['warp', 'iterm2', 'apple-terminal']` |
| Help text | `lib/commands/infra.js:906, 911` | `"// warp, iterm2, apple-terminal"` strings |
| Display name | `lib/worktree.js:1274` | `{ warp: 'Warp', iterm2: 'iTerm2', 'apple-terminal': 'Terminal.app' }` |
| Test | `tests/integration/global-config-migration.test.js` | `['warp', 'iterm2', 'apple-terminal']` implicit |

**Target state:**

Each adapter object in `lib/terminal-adapters.js` gains presentation metadata:

```js
{
  id: 'iterm2',
  displayName: 'iTerm2',
  pickerLabel: 'iTerm2',
  description: 'macOS GUI terminal; opens tmux sessions as tabs in one window.',
  platforms: ['darwin'],
  aliases: [],                 // e.g. Terminal.app has aliases: ['terminal']
  hiddenFromPicker: false,     // Linux auto-detected adapters set true
  detect(env) { ... },
  launch(cmd, opts) { ... },
  split: null,
}
```

Module exports (additive — keep existing `findAdapter`/`getAdapter`/`adapters`):

- `getTerminalIds({ platform } = {}) → string[]` — all registered IDs, optionally filtered by platform.
- `getPickerOptions({ platform }) → Array<{ value, label }>` — clack picker feed; excludes `hiddenFromPicker`.
- `getDashboardOptions() → string[]` — dashboard enum feed (macOS terminals — the Linux fallback is handled separately today and stays that way).
- `getDisplayName(id) → string` — for log messages.
- `canonicalize(value) → string | null` — walks `id`s and each adapter's `aliases`; replaces the body of `canonicalizeTerminalApp`.
- `isValidId(id) → boolean`.

**Migration / compat:**

- `canonicalizeTerminalApp` in `lib/global-config-migration.js` becomes a **thin delegate** to `terminalAdapters.canonicalize`. Keep the export name — it's used in tests and config migration. No behaviour change for legacy inputs.
- `DEFAULT_GLOBAL_CONFIG.terminalApp` in `lib/config.js` stays `'apple-terminal'` on darwin — no registry-driven default needed; the default is a deliberate platform choice, not a registry property.
- Linux auto-detection logic (`findAdapter` for linux + `LINUX_TERMINALS`) stays as-is. It's a separate code path (no user-selected `terminalApp` on Linux today) and not worth entangling with the picker registry.

**Drift-prevention test:**

New test registers a synthetic adapter (via a test-only `registerAdapter()` helper or by directly mutating the exported array in a `beforeEach`/`afterEach`) and asserts it shows up in:
- `getPickerOptions({ platform: 'darwin' })`
- `getDashboardOptions()`
- `getDisplayName(id)`
- `canonicalize(id)` returns the id
- `isValidId(id)` returns true
- The help-text generator in `infra.js` (expose as a small pure function so the test can call it without spawning the CLI).

If a future contributor adds a terminal via the old-style hardcoded paths instead of the registry, this test fails loudly.

**Files to edit (target count = 6; net reduction = 0 files touched once, but goal is that each file reads from the registry rather than containing the list):**

1. `lib/terminal-adapters.js` — extend adapter objects; add registry helpers; update exports.
2. `lib/global-config-migration.js` — replace `canonicalizeTerminalApp` body with delegate.
3. `lib/onboarding/terminal.js` — build picker options from registry.
4. `lib/dashboard-server.js` — build dashboard options from registry.
5. `lib/worktree.js` — build display-name map from registry.
6. `lib/commands/infra.js` — generate help-text list from registry (extract to a helper so the test can assert on it).
7. `tests/integration/terminal-adapter-registry.test.js` (new) — drift-prevention test.
8. `AGENTS.md` or `docs/architecture.md` — one paragraph pointing at the registry.

After this lands, adding `ghostty` is **one new adapter object** in `lib/terminal-adapters.js` — nothing else.

## Dependencies

-

## Out of Scope

- **Actually adding ghostty.** That's a separate, trivial follow-up once the registry exists (one adapter entry in `lib/terminal-adapters.js` modelled on iTerm2's AppleScript pattern; Ghostty 1.3.0+ ships an AppleScript dictionary with `make new tab at end of tabs of front window` etc.).
- **Ghostty `notify-on-command-finish` integration** (OSC-133 "agent-is-waiting" detection). This is a distinct feature worth its own spec — it would sit in the agent-monitoring layer, not the terminal adapter.
- **Fleet split-panes plugin interface.** Only Warp supports the `split()` adapter method today; iTerm2 and Terminal.app already fall back to sequential tabs/windows. Generalising `split()` (e.g. iTerm2 native splits, Ghostty splits) is a separate design.
- **Linux terminal registry.** Linux auto-detects from `LINUX_TERMINALS` and doesn't surface `terminalApp` in the picker. Not worth unifying here — different UX entirely.
- **User-pluggable adapters from outside the repo.** The registry is internal: adapters live in `lib/terminal-adapters.js`. A true user-plugin mechanism (load from `~/.aigon/plugins/terminal-*.js`) is explicitly out of scope.

## Open Questions

- Should the `description` field live on each adapter, or stay as one generic string on the dashboard settings schema? Leaning *generic* — per-terminal descriptions are marketing copy, not useful config hints. Decide during implementation.
- Should `getDashboardOptions()` respect `platforms` and exclude non-darwin terminals (which would be all of them today), or stay darwin-only for now? Leaning *darwin-only*, matching current behaviour; revisit if/when a cross-platform terminal (e.g. WezTerm) joins the registry.

## Related

- Research: <!-- none -->
- Set: <!-- standalone -->
- Prior features in set: <!-- standalone -->
