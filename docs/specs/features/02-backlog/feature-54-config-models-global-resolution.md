# Feature: config-models-global-resolution

## Summary

`aigon config models` does not resolve model overrides from the global config file (`~/.aigon/config.json`). Values set via `aigon config set --global agents.cx.research.model gpt-5.3` are correctly stored and returned by `aigon config get`, but `aigon config models` still shows the template default. Only env vars (`AIGON_CX_RESEARCH_MODEL`) are picked up.

## Bug Details

**Steps to reproduce:**
1. `aigon config set --global agents.cx.research.model gpt-5.3`
2. `aigon config get agents.cx.research.model` → returns `gpt-5.3 (from ~/.aigon/config.json)` ✅
3. `aigon config models` → still shows `gpt-5.2  template` for cx research ❌
4. `AIGON_CX_RESEARCH_MODEL=gpt-5.3 aigon config models` → shows `gpt-5.3  env` ✅

**Expected:** `aigon config models` should resolve global config values (precedence: env var > project config > global config > template default).

**Actual:** Global config is ignored; only env vars and template defaults are checked.

## User Stories

- [ ] As a user, I want to set a model override in my global config and have it apply across all repos without needing env vars

## Acceptance Criteria

- [ ] `aigon config models` resolves models from global config (`~/.aigon/config.json`) at `agents.<agent>.<task>.model`
- [ ] Precedence is correct: env var > project config > global config > template default
- [ ] The SOURCE column in `config models` output shows `global` for global config overrides
- [ ] Project-level config overrides global config

## Technical Approach

The model resolution logic in `config models` likely only checks env vars and template defaults. It needs to also read the global (and project) config files and check the `agents.<agent>.<task>.model` path.

## Dependencies

- None

## Out of Scope

- Changing the config key structure
- Adding new config commands

## Open Questions

- Should project-level config use the same `agents.<agent>.<task>.model` key path?
