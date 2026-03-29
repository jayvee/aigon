# Implementation Log: Feature 138 - import-aigon-next-workflow-core
Agent: cc

## Plan

Import the Aigon Next prototype's workflow engine into `lib/workflow-core/` as an isolated, tested CommonJS module. Port TypeScript → JS, adapt paths from `.a2/` → `.aigon/workflows/`, stub the tmux effect (Aigon already handles tmux via `lib/worktree.js`), and add xstate as a dependency. Do not change any existing commands.

## Progress

- Read and analyzed all 10 source files from `~/src/aigon-next/src/workflow/` and `~/src/aigon-next/src/effects/`
- Created 11 files in `lib/workflow-core/`: types, paths, event-store, snapshot-store, lock, projector, machine, actions, effects, engine, index
- Installed `xstate@^5.30.0` as a dependency
- Wrote 39 tests covering types, paths, event-store, snapshot-store, lock, projector, action derivation, and engine persistence
- Updated CLAUDE.md module map and state architecture section
- Updated docs/architecture.md with full workflow-core documentation and migration plan
- Added `.aigon/workflows/` to .gitignore
- Added workflow-core tests to `npm test` script
- All tests pass, existing CLI syntax check passes

## Decisions

1. **CommonJS, not ESM** — Aigon is a CommonJS codebase; porting to CJS keeps the import pattern consistent (`require('./workflow-core')`).

2. **`.aigon/workflows/` not `.a2/`** — Kept Aigon's existing `.aigon/` convention rather than introducing a new root directory. The prototype used `.a2/` but that would be confusing alongside `.aigon/state/`.

3. **Tmux effect stubbed** — The `ensure_agent_session` effect is a no-op stub because Aigon already manages tmux sessions through `lib/worktree.js`. A future feature will wire the real implementation.

4. **Engine simplified** — The `restartAgent` and `startFeature` functions don't run pending effects in this port (they just persist events). The full effect orchestration loop is preserved in `runPendingEffects` and `closeFeatureWithEffects` for when it's needed.

5. **No feature flag** — The module is simply unused by existing commands rather than gated behind a flag. The spec's open question was whether to use a flag; "simply remain unused" is simpler and the module is fully isolated behind `lib/workflow-core/index.js`.
