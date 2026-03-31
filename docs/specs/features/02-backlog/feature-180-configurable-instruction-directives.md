# Feature: Configurable instruction directives

## Summary

Add a per-repo `instructions` config block in `.aigon/config.json` that controls which feature-do steps are included when `aigon install-agent` generates command files. Today every repo gets identical mandatory steps (write tests, run Playwright, write logs, start dev server) regardless of project complexity. This feature makes those sections conditional, so simple/test repos like Brewboard can skip heavy steps while production repos keep full rigor.

The mechanism is **install-time template resolution with config-change detection**. `processTemplate()` already resolves placeholders from profile config; this extends the same pattern with an `instructions` config namespace. To ensure config changes take effect without a version bump, `check-version` is extended to also detect config changes and trigger a reinstall.

## User Stories

- [ ] As a developer using Aigon on a simple test repo, I want to skip mandatory test-writing steps so that trivial features (e.g., "add a footer") complete quickly
- [ ] As a developer on a production repo, I want full testing rigor by default without needing to configure anything
- [ ] As a developer, I want to change instruction config and have it take effect on the next agent session without running manual commands
- [ ] As a developer, I want to add more instruction filters over time (logging, plan mode, dev server) without redesigning the system

## Acceptance Criteria

### Phase 1: Testing directives
- [ ] `.aigon/config.json` supports an `instructions.testing` field with values: `"full"` (default), `"minimal"`, `"skip"`
- [ ] `"full"` — current behaviour unchanged (Steps 3.8, 4.2, 4.8 all present)
- [ ] `"minimal"` — Step 3.8 replaced with "If a test suite exists, run `npm test` to verify you haven't broken anything. Do not write new tests."; Steps 4.2 (Playwright) and 4.8 are removed
- [ ] `"skip"` — Steps 3.8, 4.2, and 4.8 are all removed from the generated command file
- [ ] `getProfilePlaceholders()` in `lib/config.js` reads `instructions.testing` from project config and resolves new conditional placeholders
- [ ] Both `feature-do.md` and `feature-now.md` templates use the new placeholders
- [ ] `aigon install-agent` regenerates command files with the correct sections based on config
- [ ] A repo with no `instructions` config gets `"full"` behaviour (backward compatible)

### Config-change detection (reinstall trigger)
- [ ] `install-agent` writes a config hash to `.aigon/config-hash` (hash of the instruction-relevant config fields)
- [ ] `check-version` (SessionStart hook) compares the stored hash against the current config; if they differ, triggers `update` (which re-runs `install-agent` for all detected agents)
- [ ] This means: edit `.aigon/config.json` → next agent session auto-regenerates command files — no manual `install-agent` needed

### Phase 2: Additional directives (future, not this feature)
- [ ] `instructions.logging` — controls Step 6 (implementation log): `"full"` | `"minimal"` | `"skip"`
- [ ] `instructions.devServer` — controls Step 6.5 (mandatory dev server start): `true` | `false`
- [ ] `instructions.planMode` — controls Step 2.5: `"auto"` (default) | `"never"` | `"always"`
- [ ] `instructions.documentation` — controls Step 4.5 (update docs): `true` | `false`
- [ ] `instructions.rigor` — preset that sets multiple directives at once: `"production"` (all full) | `"light"` (skip tests, minimal logging, no mandatory dev server, no docs update)

## Validation

```bash
node -c lib/config.js && node -c lib/templates.js
```

## Configuration Options (Phase 1)

### `instructions.testing`

Controls the level of test-writing and test-running required during feature implementation.

| Value | Step 3.8 (Write tests) | Step 4.2 (Playwright e2e) | Step 4.8 (Run npm test) | Best for |
|-------|----------------------|--------------------------|------------------------|----------|
| `"full"` (default) | **Mandatory** — write unit tests, integration tests, add cases to existing files | **Included** (if profile + Playwright enabled) | **Mandatory** — must pass before commit | Production repos, repos with established test suites |
| `"minimal"` | **Run only** — "If a test suite exists, run `npm test` to verify you haven't broken anything. Do not write new tests." | **Removed** | **Removed** (covered by the run-only instruction) | Repos with some tests but where writing new tests for every feature is overkill |
| `"skip"` | **Removed entirely** | **Removed** | **Removed** | Test/seed repos (Brewboard, Trailhead), prototyping, repos with no test infrastructure |

### Example configs

**Brewboard** (skip everything):
```json
{
  "profile": "web",
  "instructions": {
    "testing": "skip"
  }
}
```

**Production app** (explicit full, same as default):
```json
{
  "instructions": {
    "testing": "full"
  }
}
```

**Existing repo with tests but no need to write new ones per feature**:
```json
{
  "instructions": {
    "testing": "minimal"
  }
}
```

### Future options (Phase 2, not implemented now)

| Option | Values | Controls |
|--------|--------|----------|
| `instructions.logging` | `"full"` \| `"minimal"` \| `"skip"` | Step 6 — implementation log narrative |
| `instructions.devServer` | `true` \| `false` | Step 6.5 — mandatory dev server start before signaling done |
| `instructions.planMode` | `"auto"` \| `"never"` \| `"always"` | Step 2.5 — when to enter plan mode |
| `instructions.documentation` | `true` \| `false` | Step 4.5 — update docs if architecture changed |
| `instructions.rigor` | `"production"` \| `"light"` | Preset — sets multiple of the above at once |

## Technical Approach

### Template mechanism

Add three new placeholders resolved in `getProfilePlaceholders()`:

| Placeholder | Controls | Populated when |
|------------|----------|----------------|
| `{{TESTING_WRITE_SECTION}}` | Step 3.8 (write tests) | `testing` is `"full"` or `"minimal"` |
| `{{TESTING_PLAYWRIGHT_SECTION}}` | Step 4.2 (Playwright) | `testing` is `"full"` AND playwright enabled |
| `{{TESTING_RUN_SECTION}}` | Step 4.8 (run npm test) | `testing` is `"full"` |

When `testing: "skip"`, all three resolve to empty string.
When `testing: "minimal"`, `TESTING_WRITE_SECTION` becomes a lighter instruction ("run existing tests if they exist, do not write new ones"), and both `TESTING_PLAYWRIGHT_SECTION` and `TESTING_RUN_SECTION` resolve to empty string.
When `testing: "full"`, all three resolve to the current content (no change from today).

### Config-change detection

Today, `check-version` (line 1058 of `lib/commands/setup.js`) only triggers reinstall on Aigon **version** mismatch. If you edit `.aigon/config.json` after install, nothing happens until the next version bump.

Fix: after `install-agent` completes, write a hash of the instruction-relevant config to `.aigon/config-hash`. In `check-version`, compare stored hash to current config. If they differ, trigger `update` just like a version mismatch would.

Hash inputs: `JSON.stringify(projectConfig.instructions || {})` + `projectConfig.profile` + `JSON.stringify(projectConfig.verification || {})`. This keeps the hash stable when unrelated config fields change.

### Files changed

1. **`lib/config.js`** — `getProfilePlaceholders()`: read `instructions.testing` from project config, resolve the three new placeholders based on its value
2. **`templates/generic/commands/feature-do.md`** — replace hardcoded Steps 3.8, 4.2, 4.8 with `{{TESTING_WRITE_SECTION}}`, `{{TESTING_PLAYWRIGHT_SECTION}}`, `{{TESTING_RUN_SECTION}}`
3. **`templates/generic/commands/feature-now.md`** — same changes if it has equivalent test sections
4. **`lib/commands/setup.js`** — `install-agent`: write config hash after install; `check-version`: compare stored hash to current, trigger update on mismatch
5. **No changes to `processTemplate()`** — it already handles arbitrary placeholders

### Why install-time, not runtime

- Agents read static markdown files from `.claude/commands/` — there's no runtime hook to modify them mid-session
- Install-time resolution is the existing pattern (profiles, Playwright toggle, agent placeholders)
- Config-change detection ensures edits take effect on the next session without manual intervention
- Keeps agent instructions simple and inspectable — you can `cat .claude/commands/aigon/feature-do.md` to see exactly what the agent will see

## Dependencies

- None — builds on existing placeholder/profile infrastructure

## Out of Scope

- Phase 2 directives (logging, devServer, planMode, documentation, rigor presets) — designed for but not implemented here
- Per-feature complexity hints in spec YAML — possible future extension
- Per-agent overrides (e.g., `agents.cc.instructions.testing`) — defer to phase 2
- Runtime instruction modification

## Open Questions

- Should `aigon doctor` warn if `instructions.testing` is `"skip"` on a repo that has a test suite? (Probably not for phase 1)

## Related

- Profiles system (`lib/config.js` `getProfilePlaceholders()`) — same mechanism, this extends it
- Playwright verification feature (feature-56) — `verification.playwright.enabled` is a precedent for conditional instruction injection
- Brewboard/Trailhead seed repos — primary motivation
