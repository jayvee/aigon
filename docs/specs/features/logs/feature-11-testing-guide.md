# Feature 11 Testing Guide

## Setup

1. Navigate to the whenswell repo:
   ```bash
   cd /path/to/whenswell
   ```

2. Make sure you have the updated `aigon` command available:
   ```bash
   aigon config --help
   ```
   
   If testing locally without installing, you can use:
   ```bash
   aigon config --help
   ```

## Test Cases

### 1. Test `aigon config init` (Project Scope - Default)

```bash
# Remove existing project config if it exists
rm -f .aigon/config.json

# Initialize project config (should auto-detect profile)
aigon config init

# Verify it was created
cat .aigon/config.json
# Should show: {"profile": "web"} (or detected profile)

# Try again (should say already exists)
aigon config init
```

**Expected:** Creates `.aigon/config.json` with detected profile (likely "web" for whenswell).

### 2. Test `aigon config init --global`

```bash
# Remove global config if it exists
rm -f ~/.aigon/config.json

# Initialize global config
aigon config init --global

# Verify it was created
cat ~/.aigon/config.json
# Should show DEFAULT_GLOBAL_CONFIG structure

# Try again (should say already exists)
aigon config init --global
```

**Expected:** Creates `~/.aigon/config.json` with default global config.

### 3. Test `aigon config set` (Project Scope - Default)

```bash
# Set a simple value
aigon config set profile api

# Verify
cat .aigon/config.json
# Should show: {"profile": "api"}

# Set a nested value with dot-notation
aigon config set arena.testInstructions "Custom test: npm test"

# Verify
cat .aigon/config.json
# Should show nested structure:
# {
#   "profile": "api",
#   "arena": {
#     "testInstructions": "Custom test: npm test"
#   }
# }

# Set a boolean value
aigon config set someFlag true

# Set a number
aigon config set someNumber 42
```

**Expected:** Values are set correctly in project config, nested objects are created automatically.

### 4. Test `aigon config set --global`

```bash
# Set global terminal preference
aigon config set --global terminal cursor

# Verify
cat ~/.aigon/config.json
# Should show terminal: "cursor" in the config

# Set nested global value
aigon config set --global agents.cc.implementFlag "--permission-mode manual"

# Verify nested structure
cat ~/.aigon/config.json
```

**Expected:** Values are set correctly in global config.

### 5. Test `aigon config get` (Provenance)

```bash
# Get project value
aigon config get profile
# Expected: "api (from .aigon/config.json)"

# Get global value
aigon config get terminal
# Expected: "cursor (from ~/.aigon/config.json)"

# Get nested value
aigon config get arena.testInstructions
# Expected: "Custom test: npm test (from .aigon/config.json)"

# Get default value (if not set)
aigon config get agents.cc.cli
# Expected: "claude (from default)" or similar

# Get non-existent value
aigon config get nonexistent.key
# Expected: "❌ Config key "nonexistent.key" not found"
```

**Expected:** Shows value with correct source (project/global/default).

### 6. Test `aigon config show` (All Variants)

```bash
# Show merged effective config (default)
aigon config show
# Should show merged config from project + global + defaults
# Should show precedence info and file existence status

# Show project config only
aigon config show --project
# Should show only .aigon/config.json contents

# Show global config only
aigon config show --global
# Should show only ~/.aigon/config.json contents
```

**Expected:** Each variant shows appropriate config level with correct formatting.

### 7. Test Precedence Order

```bash
# Set same key in both scopes
aigon config set testKey "project-value"
aigon config set --global testKey "global-value"

# Get the value (should show project wins)
aigon config get testKey
# Expected: "project-value (from .aigon/config.json)"

# Remove project value
aigon config set testKey null
# Or manually edit .aigon/config.json to remove testKey

# Get again (should show global)
aigon config get testKey
# Expected: "global-value (from ~/.aigon/config.json)"
```

**Expected:** Project config overrides global config, which overrides defaults.

### 8. Test Profile Commands Still Work

```bash
# Profile show (should still work)
aigon profile show
# Should show profile info with port summary if applicable

# Profile set (should use new config system)
aigon profile set web

# Verify it's in project config
aigon config get profile
# Expected: "web (from .aigon/config.json)"

# Profile detect
aigon profile detect
# Should show auto-detected profile
```

**Expected:** Profile commands work as convenience shortcuts, using underlying config system.

### 9. Test Edge Cases

```bash
# Set empty string
aigon config set emptyString ""

# Set JSON object
aigon config set nestedObject '{"key": "value"}'

# Set JSON array
aigon config set array '[1, 2, 3]'

# Verify complex values
aigon config get nestedObject
aigon config get array
```

**Expected:** Complex values are parsed and stored correctly.

### 10. Test Help Messages

```bash
# Config help
aigon config
# Should show usage with all subcommands

# Config set help
aigon config set
# Should show usage for set command

# Config get help
aigon config get
# Should show usage for get command
```

**Expected:** Help messages are clear and show examples.

## Cleanup

After testing, you can clean up:

```bash
# Remove project config
rm -f .aigon/config.json

# Remove global config (optional - be careful!)
# rm -f ~/.aigon/config.json
```

## Verification Checklist

- [ ] `config init` creates project config with detected profile
- [ ] `config init --global` creates global config
- [ ] `config set` writes to project config (default)
- [ ] `config set --global` writes to global config
- [ ] `config get` shows value with correct provenance
- [ ] `config show` shows merged config
- [ ] `config show --global` shows global only
- [ ] `config show --project` shows project only
- [ ] Dot-notation works for nested keys
- [ ] Precedence order: project > global > defaults
- [ ] Profile commands still work
- [ ] Complex values (JSON, arrays) are handled correctly
