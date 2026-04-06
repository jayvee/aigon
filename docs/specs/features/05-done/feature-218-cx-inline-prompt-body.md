# Feature: cx-inline-prompt-body

## Summary
Stop depending on Codex's broken custom-prompts feature. Instead of launching `codex` with a `/prompts:aigon-feature-<verb>` slash command, read the corresponding prompt file from `~/.codex/prompts/aigon-feature-<verb>.md`, strip its YAML frontmatter, substitute `$ARGUMENTS`, and pass the resulting markdown body as the initial prompt string directly to `codex`. This makes the cx launcher immune to upstream codex regressions (openai/codex#15941) and to the eventual removal of the `/prompts:` syntax in favor of skills.

## User Stories
- [ ] As a user running `aigon feature-do 07` with `cx`, I see Codex actually load the aigon instructions and begin implementing, not stare at a literal `/prompts:aigon-feature-do 07` message that Codex treats as a user query.
- [ ] As a user running an autonomous or Fleet flow that uses `cx` for implement/eval/review, the session works on any codex version ≥ 0.105 without requiring `~/.codex/prompts/` discovery to be functional.
- [ ] As a maintainer, I can delete the `/prompts:` syntax from `templates/agents/cx.json` entirely and the system keeps working.

## Acceptance Criteria
- [ ] Launching cx for `feature-do`, `feature-eval`, and `feature-review` passes the full prompt body to codex (verified by the first model turn showing the instructions are in context — no "command not found" / "doesn't match any script" replies).
- [ ] `templates/agents/cx.json` no longer uses the `/prompts:aigon-*` form in `implementPrompt` / `evalPrompt` / `reviewPrompt`. Either those fields are dropped in favor of referencing the source template directly, or they store a plain prompt-file identifier that the launcher resolves.
- [ ] Placeholder substitution works: `$ARGUMENTS` in the template is replaced with the real feature id (and any extra flags like `--no-launch`, `--force`) before being handed to codex.
- [ ] A helper like `buildCxPromptBody(verb, args)` lives in `lib/` (probably `lib/commands/feature.js` or a small new module) and is covered by a unit test that asserts: frontmatter stripped, `$ARGUMENTS` substituted, and at least one sentinel line from the template survives.
- [ ] Drive-branch, drive-worktree, and Fleet launches all go through the same path — no divergence between `feature-do`, `feature-eval`, `feature-review`, and the autonomous launcher in how they build the cx prompt.
- [ ] `install-agent cx` still writes `~/.codex/prompts/aigon-*.md` (for users who want to invoke prompts manually if they fix their codex), but the runtime launcher does NOT rely on codex discovering those files.
- [ ] Manual smoke test passes against current codex (0.118): `aigon feature-do <id>` with `cx` in a scratch feature starts a real implementation session instead of failing.

## Validation
```bash
node -c aigon-cli.js
node -c lib/commands/feature.js
npm test
```

## Technical Approach

### Where the bug lives
- `templates/agents/cx.json` sets `cli.implementPrompt = "/prompts:aigon-feature-do {featureId}"` (and same for eval/review).
- `lib/commands/feature.js:1208` (and the sibling eval/review branches around lines 1478–1492) does `cliConfig.implementPrompt.replace('{featureId}', featureId)` and hands that as a positional arg to `codex`.
- For cc/gg/cu this works because their CLIs resolve slash commands correctly; for cx it's broken — see the investigation on 2026-04-06: Codex 0.105 and 0.118 both forward `/prompts:aigon-feature-<verb>` to the model as literal text because custom-prompt discovery from `~/.codex/prompts/` is dead (openai/codex#15941). Even when it worked, it was a TUI-only hook, and the entire feature is being deprecated in favor of skills.

### The fix
1. **Add `resolveAgentPromptBody(agentId, verb, argsString)` in `lib/commands/feature.js`** (or a small new `lib/agent-prompt-resolver.js` if it makes cross-call reuse cleaner).
   - Default: return `cliConfig.implementPrompt/.evalPrompt/.reviewPrompt` as-is with `{featureId}` substituted — preserving current cc/gg/cu behavior.
   - For `cx` specifically: resolve the template file under `templates/generic/commands/feature-<verb>.md`, run the existing placeholder processor (same one `install-agent` uses) against it with the cx placeholder set from `templates/agents/cx.json`, strip frontmatter, substitute `$ARGUMENTS` with the args string, and return the result.
   - The template lookup must use the **same** source that `install-agent cx` uses so the two paths can never drift.
2. **Wire `resolveAgentPromptBody` into all three call sites** in `lib/commands/feature.js`:
   - `feature-do` launch (~L1208)
   - `feature-eval` launch (~L1478)
   - `feature-review` launch (wherever the review prompt is built)
   - `feature-autonomous-start` → AutoConductor run loop (if it builds prompts itself for cx)
3. **Keep the worktree/Fleet spawn paths in `lib/worktree.js` consistent** — if they build prompts independently (see `lib/worktree.js:129`), route them through the same helper.
4. **Leave `install-agent cx` behavior alone** for now — writing `~/.codex/prompts/aigon-*.md` is harmless and lets users invoke prompts manually in a codex version that supports them. The runtime launcher just stops depending on discovery working.
5. **Simplify `templates/agents/cx.json`**: change `implementPrompt` / `evalPrompt` / `reviewPrompt` to a plain verb identifier (e.g. `"feature-do"`) so there's no `/prompts:` string left to mislead readers. The resolver reads the verb and maps to the template file.
6. **Unit test** `resolveAgentPromptBody` in `tests/` covering: cc passthrough unchanged, cx returns markdown body with sentinel line, `$ARGUMENTS` substituted, frontmatter stripped.
7. **Manual smoke test** — create a throwaway feature in any seed repo, run `aigon feature-do <id>` with cx, confirm codex opens and actually executes the implementation instructions.

### Explicitly NOT doing
- Not switching to Codex skills (`~/.codex/skills/`). Skills are still in flux; we'd just be trading one broken contract for another.
- Not bumping/pinning codex versions via doctor. Orthogonal and would ship slower than the code fix.
- Not touching cc/gg/cu launchers. Those work.

## Dependencies
- None — this is a contained launcher change.

## Out of Scope
- Codex skill-based launching.
- `install-agent cx` output changes.
- Unifying all agents onto a single inline-prompt model (good follow-up, but out of scope here).
- Auto-detecting codex version at runtime.

## Open Questions
- Should the resolver be cx-only, or should all agents inline their prompts at launch so cc/gg/cu also become immune to slash-command regressions in their respective CLIs? (Default: cx-only for now; follow-up feature if we want to generalize.)
- Where should the helper live — inline in `lib/commands/feature.js`, or a new `lib/agent-prompt-resolver.js`? (Default: new module, ≤100 lines, easier to unit test.)

## Related
- Investigation on 2026-04-06 (in-conversation): confirmed `/prompts:aigon-feature-eval` fails on both 0.105 and 0.118 in a scratch repo.
- openai/codex#15941 — upstream bug, custom prompts stopped appearing after 0.117.
- `templates/agents/cx.json` — where the `/prompts:` strings live today.
- `lib/commands/feature.js:1208,1478` — launch sites.
