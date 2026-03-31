# Feature: Configurable instruction directives

## Summary

Add a per-repo `instructions` config block in `.aigon/config.json` that controls which feature-do steps are included when `aigon install-agent` generates command files. Today every repo gets identical mandatory steps (write tests, run Playwright, write logs, start dev server) regardless of project complexity. This feature makes those sections conditional, so simple/test repos like Brewboard can skip heavy steps while production repos keep full rigor.

The mechanism is **install-time template resolution** — no runtime rewriting. `processTemplate()` already resolves placeholders from profile config; this extends the same pattern with an `instructions` config namespace.

## User Stories

- [ ] As a developer using Aigon on a simple test repo, I want to skip mandatory test-writing steps so that trivial features (e.g., "add a footer") complete quickly
- [ ] As a developer on a production repo, I want full testing rigor by default without needing to configure anything
- [ ] As a developer, I want to add more instruction filters over time (logging, plan mode, dev server) without redesigning the system

## Acceptance Criteria

### Phase 1: Testing directives
- [ ] `.aigon/config.json` supports an `instructions.testing` field with values: `"full"` (default), `"minimal"`, `"skip"`
- [ ] `"full"` — current behaviour unchanged (Steps 3.8, 4.2, 4.8 all present)
- [ ] `"minimal"` — Step 3.8 replaced with "Run existing tests if present (`npm test`), but do not write new tests"; Steps 4.2 (Playwright) and 4.8 removed
- [ ] `"skip"` — Steps 3.8, 4.2, and 4.8 are all removed from the generated command file
- [ ] `getProfilePlaceholders()` in `lib/config.js` reads `instructions.testing` from project config and resolves new conditional placeholders
- [ ] Both `feature-do.md` and `feature-now.md` templates use the new placeholders
- [ ] `aigon install-agent` regenerates command files with the correct sections based on config
- [ ] A repo with no `instructions` config gets `"full"` behaviour (backward compatible)

### Phase 2: Additional directives (future, not this feature)
- [ ] `instructions.logging` — controls Step 6 (implementation log): `"full"` | `"minimal"` | `"skip"`
- [ ] `instructions.devServer` — controls Step 6.5 (mandatory dev server start): `true` | `false`
- [ ] `instructions.planMode` — controls Step 2.5: `"auto"` (default) | `"never"` | `"always"`
- [ ] `instructions.rigor` — preset that sets multiple directives at once: `"production"` (all full) | `"light"` (skip tests, minimal logging, no mandatory dev server)

## Validation

```bash
node -c lib/config.js && node -c lib/templates.js
```

## Technical Approach

### Config schema

```json
{
  "instructions": {
    "testing": "skip"
  }
}
```

### Template mechanism

Add three new placeholders resolved in `getProfilePlaceholders()`:

| Placeholder | Controls | Populated when |
|------------|----------|----------------|
| `{{TESTING_WRITE_SECTION}}` | Step 3.8 (write tests) | `testing` is `"full"` or `"minimal"` |
| `{{TESTING_PLAYWRIGHT_SECTION}}` | Step 4.2 (Playwright) | `testing` is `"full"` AND playwright enabled |
| `{{TESTING_RUN_SECTION}}` | Step 4.8 (run npm test) | `testing` is `"full"` or `"minimal"` |

When `testing: "skip"`, all three resolve to empty string.
When `testing: "minimal"`, `TESTING_WRITE_SECTION` becomes a lighter instruction ("run existing tests if they exist, do not write new ones"), and `TESTING_PLAYWRIGHT_SECTION` is empty.

### Files changed

1. **`lib/config.js`** — `getProfilePlaceholders()`: read `instructions.testing`, resolve the three new placeholders
2. **`templates/generic/commands/feature-do.md`** — replace Steps 3.8, 4.2, 4.8 with `{{TESTING_WRITE_SECTION}}`, `{{TESTING_PLAYWRIGHT_SECTION}}`, `{{TESTING_RUN_SECTION}}`
3. **`templates/generic/commands/feature-now.md`** — same changes if it has equivalent sections
4. **No changes to `processTemplate()`** — it already handles arbitrary placeholders

### Why install-time, not runtime

- Agents read static markdown files from `.claude/commands/` — there's no runtime hook to modify them
- Install-time resolution is the existing pattern (profiles, Playwright toggle)
- `aigon install-agent` is already run after config changes (and the auto-update hook re-runs it)
- Keeps agent instructions simple and inspectable (you can read the generated file to see exactly what the agent will see)

## Dependencies

- None — builds on existing placeholder/profile infrastructure

## Out of Scope

- Phase 2 directives (logging, devServer, planMode, rigor presets) — designed for but not implemented here
- Per-feature complexity hints in spec YAML — possible future extension
- Runtime instruction modification

## Open Questions

- Should `aigon doctor` warn if `instructions.testing` is `"skip"` on a repo that has a test suite? (Probably not for phase 1)
- Should the config support per-agent overrides (e.g., `agents.cc.instructions.testing`)? (Defer to phase 2)

## Related

- Profiles system (`lib/config.js` `getProfilePlaceholders()`) — same mechanism
- Playwright verification feature (feature-56) — the `verification.playwright.enabled` config is a precedent for conditional instruction injection
- Brewboard/Trailhead seed repos — primary motivation
