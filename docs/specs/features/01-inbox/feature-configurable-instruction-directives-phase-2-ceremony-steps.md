# Feature: Configurable instruction directives — Phase 2 (ceremony steps)

depends_on: feature-180-configurable-instruction-directives

## Summary

Extend the `instructions` config namespace (introduced in feature 180) with additional directives that control the ceremony steps in feature-do: implementation logging, mandatory dev server start, plan mode, and documentation updates. Also add a `rigor` preset that sets multiple directives at once for common configurations.

Feature 180 established the pattern (config → placeholder → install-time template resolution with config-change detection). This feature adds more knobs using that same pattern.

## User Stories

- [ ] As a developer on a simple repo, I want to skip implementation log narratives so the agent doesn't spend time writing paragraphs about a one-line change
- [ ] As a developer, I want to disable mandatory dev server start when I don't need a running preview
- [ ] As a developer, I want to force agents to skip plan mode on repos where features are always simple
- [ ] As a developer, I want a single `"rigor": "light"` preset that makes everything fast without configuring each directive individually

## Acceptance Criteria

### `instructions.logging`
- [ ] Values: `"full"` (default) | `"minimal"` | `"skip"`
- [ ] `"full"` — current behaviour: Step 6 requires key decisions, conversation summary, issues, rationale
- [ ] `"minimal"` — Step 6 replaced with: "Update the log with a one-line summary of what you implemented"
- [ ] `"skip"` — Step 6 removed entirely (no log update, no log commit)
- [ ] When `"skip"`, Step 5 (commit) absorbs any mention of log committing — single commit workflow

### `instructions.devServer`
- [ ] Values: `true` (default) | `false`
- [ ] `true` — current behaviour: Step 6.5 requires starting dev server before signaling done
- [ ] `false` — Step 6.5 removed; agent signals completion immediately after commit

### `instructions.planMode`
- [ ] Values: `"auto"` (default) | `"never"` | `"always"`
- [ ] `"auto"` — current behaviour: Step 2.5 gives heuristics for when to use plan mode
- [ ] `"never"` — Step 2.5 replaced with: "Skip plan mode — implement directly"
- [ ] `"always"` — Step 2.5 replaced with: "Enter plan mode before implementing"

### `instructions.documentation`
- [ ] Values: `true` (default) | `false`
- [ ] `true` — current behaviour: Step 4.5 checks if docs need updating
- [ ] `false` — Step 4.5 removed

### `instructions.rigor` (preset)
- [ ] Values: `"production"` (default) | `"light"`
- [ ] `"production"` — all directives at their default/full values
- [ ] `"light"` — equivalent to: `testing: "skip"`, `logging: "skip"`, `devServer: false`, `planMode: "never"`, `documentation: false`
- [ ] Individual directives override the preset (e.g., `rigor: "light"` + `testing: "minimal"` → testing is minimal, everything else is light)
- [ ] `rigor` is resolved first, then individual directives layer on top

### Template changes
- [ ] New placeholders: `{{LOGGING_SECTION}}`, `{{DEV_SERVER_SECTION}}`, `{{PLAN_MODE_SECTION}}`, `{{DOCUMENTATION_SECTION}}`
- [ ] Both `feature-do.md` and `feature-now.md` templates updated
- [ ] Config-change hash (from feature 180) includes the new fields

## Validation

```bash
node -c lib/config.js && node -c lib/templates.js
```

## Configuration Options

### Full config example (light rigor with one override)

```json
{
  "instructions": {
    "rigor": "light",
    "testing": "minimal"
  }
}
```

Resolves to: testing=minimal, logging=skip, devServer=false, planMode=never, documentation=false.

### Per-directive reference

| Option | Values | Default | Controls |
|--------|--------|---------|----------|
| `testing` | `"full"` \| `"minimal"` \| `"skip"` | `"full"` | Steps 3.8, 4.2, 4.8 (from feature 180) |
| `logging` | `"full"` \| `"minimal"` \| `"skip"` | `"full"` | Step 6 — implementation log |
| `devServer` | `true` \| `false` | `true` | Step 6.5 — start dev server before done |
| `planMode` | `"auto"` \| `"never"` \| `"always"` | `"auto"` | Step 2.5 — plan mode consideration |
| `documentation` | `true` \| `false` | `true` | Step 4.5 — update docs |
| `rigor` | `"production"` \| `"light"` | `"production"` | Preset — sets all of the above |

### Brewboard config after both features

```json
{
  "profile": "web",
  "instructions": {
    "rigor": "light"
  }
}
```

One line. All ceremony removed.

## Technical Approach

Same pattern as feature 180:
1. `getProfilePlaceholders()` reads each directive from `instructions`, applying `rigor` preset first then individual overrides
2. New placeholders resolve to full content, minimal content, or empty string
3. Templates reference placeholders instead of hardcoded steps
4. Config-change hash includes all directive fields

### Files changed

1. **`lib/config.js`** — `getProfilePlaceholders()`: add rigor preset resolution + 4 new placeholder mappings
2. **`templates/generic/commands/feature-do.md`** — replace Steps 2.5, 4.5, 6, 6.5 with placeholders
3. **`templates/generic/commands/feature-now.md`** — same if applicable
4. **`lib/commands/setup.js`** — update config hash to include new fields

## Dependencies

- feature-180-configurable-instruction-directives (establishes the pattern, config namespace, and config-change detection)

## Out of Scope

- Per-feature complexity hints in spec YAML
- Per-agent overrides (`agents.cc.instructions.*`)
- Additional rigor presets beyond production/light
- Runtime instruction modification

## Open Questions

- Should there be a `"moderate"` rigor preset between production and light? (e.g., minimal logging + minimal testing but keep dev server and docs)
- Should `aigon init` prompt for rigor level during setup?

## Related

- Feature 180 — configurable instruction directives phase 1 (testing)
- Brewboard/Trailhead seed repos — primary motivation
