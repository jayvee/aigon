---
complexity: medium
---

# Feature: consolidate-research-submit-into-agent-status

## Summary

`aigon agent-status submitted` and `aigon research-submit <ID> <agent>` both mark a research agent's findings as complete and emit an equivalent engine signal. Their coexistence creates a confusing dual-path: agents and humans don't know which to run, the docs refer to both inconsistently, and Gemini in particular has gotten confused and called the wrong one (or called `research-submit` without the required agent arg, getting a silent emoji-encoded failure).

This feature makes `agent-status submitted` the single path by extending it to accept optional `[ID] [agent]` positional args that override auto-detection. When explicit args are provided, tmux/branch detection is skipped entirely. `research-submit` is then removed and all references pointing to it are updated to use `agent-status submitted` instead. Public-facing docs (agent.md, research-do.md, research-submit.md template, help.md) are updated accordingly.

## Options Considered

Three other options were evaluated before choosing Option A:

- **Option B — thin alias:** Keep `research-submit` but make it call `agent-status submitted` internally. Doesn't fix the UX confusion; two commands still appear in docs and agent context.
- **Option C — docs-only fix:** Label `research-submit` as "human intervention fallback" and `agent-status submitted` as "agent form." No code change, but the dual-path remains and users still see two commands.
- **Option D — better error message only:** When `agent-status submitted` fails context detection, print `"Run: aigon agent-status submitted <ID> <agent>"` as a guided error. Solves the stuck-human case without adding explicit arg support. Simpler than Option A but loses the ability to pass args directly in non-interactive contexts.

Option A was chosen because it eliminates the duplicate command entirely and gives humans a single memorable interface for both the in-session and out-of-session cases.

## User Stories

- [ ] As an agent running inside a research tmux session, I run `aigon agent-status submitted` with no args and it auto-detects my research ID and agent from the session name (unchanged behaviour).
- [ ] As a human intervening from a plain shell with no tmux context, I run `aigon agent-status submitted 37 gg` and it submits research 37 for agent gg without needing a tmux session.
- [ ] As an agent or human who has forgotten which command to run, there is only one command to learn — `agent-status submitted` — and the docs point only to it.
- [ ] Running `aigon research-submit` after this change prints a clear deprecation/removal message pointing to `agent-status submitted`, and exits non-zero.

## Acceptance Criteria

- [ ] `aigon agent-status submitted <ID> <agent>` works from `main` branch with no tmux context — skips branch and session detection, writes engine signal and status file for the given entity+agent.
- [ ] Entity type (feature vs research) is auto-detected from the workflow snapshot when explicit args are used: if a research snapshot exists for `<ID>`, treat as research; if a feature snapshot exists, treat as feature; if both or neither exist, error with a clear message.
- [ ] `aigon agent-status submitted` with no args continues to work exactly as before (branch detection → session name detection → error).
- [ ] `aigon research-submit` is removed from `lib/commands/research.js`. Its registration in the command dispatch table is deleted.
- [ ] `aigon research-submit` prints a deprecation/removal notice and exits 1 if somehow still invoked (guard in `aigon-cli.js` or the dispatch table, not dead code).
- [ ] `templates/generic/commands/research-submit.md` is removed (the slash command template no longer exists).
- [ ] All references to `research-submit` in agent instruction templates are updated to `agent-status submitted [ID] [agent]`.
- [ ] The stale reference in `templates/generic/commands/research-eval.md:97` ("which happens as part of research-submit later") is corrected to "which clears automatically on the next `agent-status` write".
- [ ] `templates/generic/docs/agent.md` Drive Mode research workflow step 5 is updated to use the new explicit-arg form as the fallback example.
- [ ] `templates/generic/commands/help.md` no longer lists `research-submit`.
- [ ] `templates/generic/commands/research-do.md` Option A / Option B block is simplified: only `agent-status submitted` is shown, with the explicit-arg form as the fallback (no more "if this prints use `aigon research-submit`…" escape hatch).
- [ ] `npm test` passes.
- [ ] `node -c aigon-cli.js` passes.

## Validation

```bash
node -c aigon-cli.js
npm test
```

## Pre-authorised

- May remove `templates/generic/commands/research-submit.md` without a separate confirmation step.
- May delete the `'research-submit'` handler block in `lib/commands/research.js` in full.

## Technical Approach

### 1. Extend `agent-status submitted` in `lib/commands/misc.js`

In the `agent-status` handler (around line 208), after the existing branch-detection and tmux-detection block, add an explicit-args override path:

```
if (status === 'submitted' && positionalArgs[1] && positionalArgs[2]) {
    // explicit: aigon agent-status submitted <ID> <agent>
    featureNum = positionalArgs[1].padStart(2, '0');
    agentId    = positionalArgs[2];
    // auto-detect entity type from snapshot
    entityType = detectEntityTypeFromSnapshot(mainRepo, featureNum);
    if (!entityType) { error and return; }
}
```

Parse positional args from `args` before the existing detection logic so the explicit path short-circuits branch/tmux detection. The security scan, findings-file check (optional bonus — see below), and `writeAgentStatusAt` call all remain shared.

Entity-type detection: check `getSnapshotPathForEntity(mainRepo, 'research', featureNum)` first, then `getSnapshotPath(mainRepo, featureNum)`. This mirrors the logic already in `force-agent-ready` (misc.js:547–550).

Optional: port the findings-file existence check from `research-submit` into the explicit-args path so humans get an early error if they forgot to write the file.

### 2. Remove `research-submit` from `lib/commands/research.js`

Delete the `'research-submit'` handler block (lines 531–592). Remove its entry from the dispatch table. If the CLI dispatch shim in `aigon-cli.js` has a hard-coded alias for `research-submit`, replace it with a stub that prints the removal notice and exits 1.

### 3. Update `extract-cli-modules.js`

`scripts/extract-cli-modules.js` lists all public command names. Remove `'research-submit'` from that list (line 71).

### 4. Template and doc updates (all in `templates/generic/`)

These are the files that require content changes. `.claude/commands/` copies are gitignored and regenerated — do not edit them directly.

| File | Change |
|---|---|
| `commands/research-submit.md` | Delete file |
| `commands/research-do.md` | Remove the Option A / Option B split; replace with a single block showing `aigon agent-status submitted` as the primary form and `aigon agent-status submitted <ID> <agent>` as the explicit fallback for out-of-session use. Remove the "if this prints use research-submit" escape hatch. |
| `commands/research-eval.md:97` | Fix stale text: "which happens as part of research-submit later" → "which clears automatically on the next `agent-status` write" |
| `commands/help.md` | Remove `research-submit` from the research commands table |
| `commands/research-autopilot.md` | Audit for any `research-submit` references; replace with `agent-status submitted` |
| `docs/agent.md` | In the Drive Mode research workflow, update step 5 to show explicit-arg form as fallback; remove any mention of `research-submit` |

### 5. Agent-template JSON updates (`templates/agents/`)

`gg.json`, `cc.json`, `cx.json`, `cu.json` embed agent instruction strings that may reference `research-submit`. Grep and replace all occurrences with the appropriate `agent-status submitted` form.

### 6. No workflow-engine changes

The engine already treats `signal.agent_submitted` and `signal.agent_ready` identically (engine.js:519–526). No new event types or state machine changes are needed.

## Dependencies

- None

## Out of Scope

- Changing how `agent-status implementing`, `reviewing`, `review-complete`, `feedback-addressed`, or `awaiting-input` work — the explicit-args extension applies only to `submitted` since that is the only subcommand with a parallel explicit command.
- Adding a `--feature` / `--research` flag for disambiguation. Auto-detection from the snapshot (same logic as `force-agent-ready`) is sufficient and keeps the interface clean.
- Changing `force-agent-ready` — it uses a different engine event (`force-agent-ready`) with different semantics (recovery, not lifecycle) and is not a dual-path of `agent-status submitted`.
- Updating `.claude/commands/` files directly (they are generated from `templates/generic/commands/`).

## Open Questions

- Should the explicit-args path also validate that a findings file exists (porting the check from `research-submit`)? Low effort bonus but not strictly required for the consolidation. Lean yes.
- Should `research-submit` emit a deprecation warning for one release cycle before being removed, or just be deleted outright? Given that it was an agent-facing command that already confused agents, a clean removal with a stub error message is preferred.

## Related

- Research: n/a — emerged from a debugging session on r37 (Gemini called `research-submit 37` without agent arg; the `❌` emoji rendered as `â` in Gemini's terminal, masking the "multiple agents found" error)
- Set: standalone
