# Feature: profile-placeholders-as-config-not-code

## Summary
config.js (1,438 lines) has ~400 lines of `getProfilePlaceholders()` that builds placeholder maps imperatively with if/else chains per profile (web, api, ios, android, library, generic). Replace with a JSON config file `templates/profiles.json` that maps `profile -> placeholder -> value`. The resolution function becomes a 20-line JSON merge: load base profile, overlay user overrides, return map.

## User Stories
- [ ] As a maintainer, I want to see all profile differences in one JSON file instead of tracing if/else branches
- [ ] As a contributor, I want to add a new profile by adding a JSON block, not writing code
- [ ] As a user, I want to override specific placeholders in `.aigon/config.json` without editing source code

## Acceptance Criteria
- [ ] `templates/profiles.json` exists: all 6 profiles with their placeholder maps (data, not code)
- [ ] Base/shared placeholders defined once, profile-specific values override them
- [ ] `getProfilePlaceholders()` in config.js is under 30 lines: load JSON, merge base + profile + user overrides
- [ ] `lib/config.js` under 1,000 lines (from 1,438)
- [ ] Profile auto-detection logic stays as code (it inspects the filesystem — not convertible to data)
- [ ] All placeholder values identical before and after — pure refactor
- [ ] `npm test` passes; `aigon install-agent cc` produces identical output

## Validation
```bash
wc -l lib/config.js                # expect < 1000
cat templates/profiles.json | node -e "JSON.parse(require('fs').readFileSync(0))"  # valid JSON
node --check lib/config.js
npm test
```

## Technical Approach
- Extract current placeholder values from each if/else branch into JSON structure
- JSON structure: `{ "base": { "KEY": "val" }, "web": { "KEY": "override" }, "ios": { ... } }`
- Resolution: `Object.assign({}, profiles.base, profiles[profile], userOverrides)`
- Keep `detectProfile()` as code — it checks for package.json, Podfile, etc.
- Keep `getActiveProfile()` as code — it resolves explicit config over detection
- Only the placeholder value mapping becomes data

## Dependencies
- None — pure internal refactor

## Out of Scope
- Adding new profiles
- Changing profile auto-detection heuristics
- Modifying the template processing pipeline
