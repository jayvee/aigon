# Implementation Log: Feature 20 - cross-provider-eval
Agent: cc

## Plan

Read the spec and explored the existing `feature-eval` command in `aigon-cli.js`. The command already detected the mode (solo/arena) and collected worktree info. The plan was to:

1. Add `PROVIDER_FAMILIES` constant and `isSameProviderFamily()` helper near the top of the file (alongside other utility functions).
2. Extend the `feature-eval` command handler to parse `--allow-same-model-judge`, detect the evaluating agent via `detectActiveAgentSession()`, resolve the implementer agent(s), compare families, and emit the bias warning.
3. Surface the `evaluate` task type model in the summary output (already wired up in Feature 19).
4. Add a test file since the project had none.

## Progress

### `aigon-cli.js` — new constant + utility (lines ~132–151)

```js
const PROVIDER_FAMILIES = { cc: 'anthropic', cu: 'varies', gg: 'google', cx: 'openai' };

function isSameProviderFamily(agentA, agentB) { ... }
```

Added just before `// --- Configuration ---` so it's available to the rest of the file.

### `aigon-cli.js` — `feature-eval` command updates

- **Flag parsing**: `--allow-same-model-judge` is stripped from args before positional resolution, so `name = positionalArgs[0]` still works correctly.
- **Bias detection block** (inserted after `const mode = ...`):
  - Solo mode: infers implementer from solo worktree or branch name (`feature-N-<agent>-desc` pattern).
  - Arena mode: warns if the evaluating agent shares a family with any implementer worktree; suggests an alternative.
  - Both modes: shows suggested `--agent=<alt>` and `--allow-same-model-judge` escape hatch.
- **Summary output**: added `Evaluator: <agent> (<family>) — model: <model>` line.

### `aigon-cli.test.js` (new file)

17 unit tests using Node's built-in `assert` module — no external dependencies. Covers: family map values, same-family pairs, cross-family pairs, `varies` never matching, and unknown agents.

### `package.json`

Updated `test` script from the placeholder error to `node aigon-cli.test.js`.

## Decisions

**Inlining the test constants vs. importing from CLI**: The CLI has significant side-effects on load (reads configs, stat-checks paths). Rather than refactoring to make it importable, the test file re-declares the two small functions under test. This keeps tests fast and dependency-free.

**`varies` never triggers warning**: Cursor proxies multiple providers; it would be a false positive to flag `cu vs cc`. The spec explicitly calls this out in the provider family map comment.

**Solo implementer detection order**: First checks for a solo worktree (`worktrees.length === 1`), then falls back to parsing the branch name. Branch-name parsing is a heuristic and can miss edge cases (e.g., non-standard branch names), but it covers the common case and fails silently rather than crashing.

**No change to `feature-eval`'s core file-management logic**: The bias warning is purely additive — it logs to stdout before the existing template creation, leaving all existing behavior unchanged.

**`--agent` flag not yet wired**: The spec mentions `aigon feature-eval 55 --agent=gg` as a suggested command, but the `--agent` flag routing isn't implemented in the current CLI. The warning still shows the command as guidance; wiring the routing is left for a follow-up or Feature 21.
