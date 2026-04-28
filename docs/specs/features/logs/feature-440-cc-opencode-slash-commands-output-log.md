# Implementation Log: Feature 440 - opencode-slash-commands-output
Agent: cc

## Status
Complete. All 7 new integration tests pass; full suite 61/62 (pre-existing worktree-state-reconcile failure unrelated).

## New API Surface
- `outputs: [...]` array key on agent JSON configs. Each entry is an output spec (same fields as the legacy `output:` object: `format`, `commandDir`, `commandFilePrefix`, `commandFileExtension`, `skillFileName`, `frontmatter`, `global`).
- `config.output` is kept as a backward-compat alias pointing at `outputs[0]`. All existing callers continue to read `config.output` without change.

## Key Decisions
- **Normalisation in `lib/agent-registry.js` `_loadAll()`**: single point where `output`↔`outputs` are reconciled at load time. If `outputs` exists but `output` doesn't, `output = outputs[0]` is synthesised. If `output` exists but `outputs` doesn't, `outputs = [output]` is synthesised. Chosen over normalising inside `setup.js` to keep all consumers consistent.
- **`op.json` uses `outputs` only** (no `output` key in the JSON file). The loader adds `output` at runtime.
- **Flat `.opencode/commands/aigon-*.md` as primary output**: OpenCode discovers commands by flat filename prefix, not subfolder, so `commandDir: ".opencode/commands"` with `commandFilePrefix: "aigon-"` is correct. Alias files land in `.opencode/` (parent of `commands/`), consistent with how cc places aliases in `.claude/` above `.claude/commands/aigon/`.
- **`setup.js` loop**: outer `if (config.output)` replaced with `for (const outputSpec of config.outputs)`. A synthetic `outputConfig = { ...mergedConfig, output: outputSpec }` is constructed each iteration so `formatCommandOutput`, `removeDeprecatedCommands`, and `removeDeprecatedSkillDirs` (which still read `agentConfig.output`) continue to work without signature changes.

## Gotchas / Known Issues
- The "72 created" log line from `install-agent op` counts both commands in `.opencode/commands/` (40) and alias shortcut files in `.opencode/` (32). This is expected and consistent with how other agents count.
- `op.json` `modelOptions` untouched — diff shows only the output-config change.

## Explicitly Deferred
- Bulk migration of other agents (`gg`, `cx`, `cu`) from single `output:` to `outputs:` in their JSON files (loader already handles it; no user-visible change needed).
- OpenCode end-to-end palette verification (requires `opencode` binary locally). Flat `.opencode/commands/aigon-*.md` is the documented discovery path per OpenCode docs.

## For the Next Feature in This Set
- None.

## Test Coverage
7 new integration tests in `tests/integration/install-agent-multi-output.test.js`:
- op flat output written, skill tree preserved, equal command counts, idempotent
- cc single-output regression (normalization doesn't break it)
- registry normalization contract: `outputs.length === 2` for op, `outputs.length === 1` for cc, `output === outputs[0]` for both
