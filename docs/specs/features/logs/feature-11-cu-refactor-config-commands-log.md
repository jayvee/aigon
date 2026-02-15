# Implementation Log: Feature 11 - refactor-config-commands
Agent: cu

## Plan

Refactor config commands to unify under `aigon config` with scope flags (`--global`/`--project`), defaulting to project scope. Keep `aigon profile` as convenience shortcuts.

## Progress

✅ **Helper Functions Added:**
- `saveGlobalConfig()` - Save global config to `~/.aigon/config.json`
- `getNestedValue()` - Get nested values using dot-notation paths
- `setNestedValue()` - Set nested values using dot-notation paths
- `parseConfigScope()` - Parse `--global`/`--project` flags from args
- `getConfigValueWithProvenance()` - Get config value with source tracking (project > global > default)
- `getEffectiveConfig()` - Get merged config from all levels

✅ **Config Command Refactored:**
- `aigon config init` - Creates project config by default (with detected profile)
- `aigon config init --global` - Creates global config (previous behavior)
- `aigon config set <key> <value>` - Sets project config (default scope)
- `aigon config set --global <key> <value>` - Sets global config
- `aigon config set --project <key> <value>` - Explicitly sets project config
- `aigon config get <key>` - Shows value with provenance (e.g., "web (from .aigon/config.json)")
- `aigon config show` - Shows merged effective config (default)
- `aigon config show --global` - Shows global config only
- `aigon config show --project` - Shows project config only

✅ **Dot-notation Support:**
- Supports nested keys like `arena.testInstructions`, `agents.cc.implementFlag`
- Automatically creates nested objects when setting values

✅ **Profile Commands:**
- `aigon profile` commands remain as convenience shortcuts
- Continue to work with new config system (use `loadProjectConfig()`/`saveProjectConfig()`)

## Decisions

1. **Default Scope:** Project scope is the default (most common use case)
   - `config set` defaults to project scope
   - `config init` defaults to project scope
   - `config show` defaults to merged view (not project-only) for better visibility

2. **Value Parsing:** Attempts to parse JSON, booleans, numbers; falls back to string
   - Handles: `true`/`false`, `null`, integers, floats, JSON objects/arrays
   - Multi-word values are joined with spaces

3. **Config Merging:** Precedence order: project > global > defaults
   - `getEffectiveConfig()` starts with `DEFAULT_GLOBAL_CONFIG`, merges global, then project
   - Project config completely overrides global for same keys
   - Nested objects (like `agents`) are merged at the property level

4. **Provenance Display:** Shows source file path (`.aigon/config.json`, `~/.aigon/config.json`, or `default`)
   - `config get` shows where each value comes from
   - Helps users understand which config level is being used

5. **Profile Init:** `aigon config init` (project) auto-detects and sets profile; `--global` flag for global config creation
   - Project init uses `detectProjectProfile()` to set initial profile
   - Global init creates `DEFAULT_GLOBAL_CONFIG` structure

6. **Output Cleanup:** Removed redundant "Project Profile" summary from `config show` output
   - Profile is already visible in the merged JSON (`"profile": "web"`)
   - Reduces visual clutter while maintaining all information

7. **Scope Flag Parsing:** Special handling for `config show` command
   - `config show` defaults to merged view (not project scope)
   - `config set` defaults to project scope
   - Flags (`--global`/`--project`) explicitly override defaults

## Implementation Details

**Files Modified:**
- `aigon-cli.js` (~325 lines added, ~45 lines removed)
  - Added helper functions after `saveProjectConfig()` (lines ~196-329)
  - Refactored `config` command handler (lines ~3874-4011)
  - Profile commands unchanged (still work as convenience shortcuts)

**Key Functions:**
- `getNestedValue()` / `setNestedValue()` - Dot-notation path traversal for nested JSON
- `parseConfigScope()` - Extracts scope flags from command args
- `getConfigValueWithProvenance()` - Returns value with source tracking
- `getEffectiveConfig()` - Deep merges project > global > defaults

**Testing:**
- Verified all commands work correctly on whenswell repo
- Tested scope flags (`--global`/`--project`)
- Tested dot-notation for nested keys (`arena.testInstructions`, `agents.cc.cli`)
- Verified provenance display shows correct sources
- Confirmed profile commands still work as shortcuts
- Installed and tested updated version in `/opt/homebrew/lib/node_modules/aigon/`

## Issues Resolved

1. **Initial bug:** `config show` was defaulting to project scope instead of merged view
   - **Fix:** Special handling for `show` subcommand to check flags directly instead of using `parseConfigScope()` default

2. **Output redundancy:** Profile summary appeared separately from merged config
   - **Fix:** Removed redundant profile summary section since `profile` is already in merged JSON

3. **Config merging:** Needed to ensure proper deep merging of nested objects
   - **Fix:** Improved `getEffectiveConfig()` to handle nested object merging correctly
