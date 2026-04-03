# Feature: remove feature-submit and enforce feature-do submission

## Summary

`feature-submit` is currently in a broken half-state: it still appears in prompt docs, command metadata, and agent-facing instructions, but it is not implemented as a real CLI handler. This causes agents, especially Codex, to confuse prompt names with executable CLI commands and invent `aigon feature-submit` as a shell command. At the same time, `feature-do` already intends to own the full implementation flow, including the final `aigon agent-status submitted` signal. This feature removes `feature-submit` from code and docs completely, and tightens `feature-do` so agents cannot truthfully claim completion until the submission signal has succeeded.

## User Stories

- [ ] As a developer using `feature-do`, I have one clear completion path: the agent finishes implementation by running `aigon agent-status submitted`, not by guessing between multiple submit mechanisms.
- [ ] As a Codex user, I do not see `feature-submit` presented as a runnable command when it is not actually implemented, so the agent does not improvise a nonexistent CLI command.
- [ ] As a maintainer, I can rely on `feature-do` to define the canonical worktree/drive completion contract for feature implementation.

## Acceptance Criteria

- [ ] All agent-facing docs, templates, and help text stop presenting `feature-submit` as a normal feature workflow command
- [ ] `feature-submit` is removed from command metadata, prompt-install outputs, and other command lists where it appears as if it were a supported command
- [ ] `templates/generic/commands/feature-submit.md` is deleted (not tombstoned — complete removal so it is never installed to agent command dirs)
- [ ] `'feature-submit'` entry removed from `lib/templates.js` COMMAND_REGISTRY (including the `afsb` alias)
- [ ] `'feature-submit'` entry removed from `lib/action-scope.js`
- [ ] All four agent JSON configs (`templates/agents/cc.json`, `cx.json`, `gg.json`, `cu.json`) no longer reference `feature-submit`
- [ ] `feature-do` explicitly states that implementation is not complete until `aigon agent-status submitted` exits successfully
- [ ] `feature-do` explicitly tells the agent not to say "done", "complete", or "ready for review" before `aigon agent-status submitted` succeeds
- [ ] `feature-do` explicitly tells the agent not to improvise with `feature-submit`, `feature-close`, or other substitute commands if `aigon agent-status submitted` fails
- [ ] `feature-do` explicitly tells the agent to report the exact error and stop for user guidance if the submit signal fails
- [ ] All five agent docs (`docs/agents/codex.md`, `claude.md`, `gemini.md`, `cursor.md`, `mistral-vibe.md`) no longer reference `feature-submit` as a workflow step
- [ ] `next`/help text and other workflow guidance point users to `feature-do` + `aigon agent-status submitted` instead of `feature-submit`
- [ ] `research-submit` remains intact; this feature only removes `feature-submit`
- [ ] Post-cleanup grep returns zero matches for `feature-submit` across all agent-visible surfaces (see Validation)

## Validation

```bash
node -c lib/templates.js
node -c lib/action-scope.js
node -c lib/commands/setup.js
node -c lib/commands/misc.js
npm test

# Must return zero matches — any output means something was missed:
grep -r "feature-submit" templates/ docs/agents/ lib/templates.js lib/action-scope.js && echo "FAIL: references remain" || echo "PASS: clean"
```

## Technical Approach

Update the prompt/docs layer, command metadata, and agent configs together so the workflow contract is internally consistent. Decision: remove `feature-submit` completely from all agent-visible surfaces — keeping it as a "legacy artifact" is dangerous because agents will continue to invoke it as a real command.

### 1. Delete `feature-submit` template and registry entries

- **Delete** `templates/generic/commands/feature-submit.md` — complete removal so it is never copied to `.claude/commands/`, `.gemini/commands/`, etc. during `install-agent`
- **Remove** `'feature-submit': { aliases: ['afsb'] }` from `lib/templates.js` COMMAND_REGISTRY
- **Remove** `'feature-submit': { scope: 'feature-local' }` from `lib/action-scope.js`

### 2. Clean agent JSON configs (all four)

Remove any `feature-submit` references from:
- `templates/agents/cc.json`
- `templates/agents/cx.json`
- `templates/agents/gg.json`
- `templates/agents/cu.json`

### 3. Clean agent docs (all five)

Remove `feature-submit` as a workflow step from:
- `docs/agents/codex.md`
- `docs/agents/claude.md`
- `docs/agents/gemini.md`
- `docs/agents/cursor.md`
- `docs/agents/mistral-vibe.md`

Replace any mention with the canonical path: implement via `feature-do`, signal completion with `aigon agent-status submitted`.

### 4. Clean shared templates

- `templates/generic/docs/agent.md` — remove `feature-submit` from command listing
- `templates/generic/commands/help.md` — remove from command table
- `templates/help.txt` — remove from help text
- `templates/generic/commands/next.md` — replace `feature-submit` guidance with `aigon agent-status submitted`

### 5. Make `feature-do` the canonical completion contract

Strengthen `templates/generic/commands/feature-do.md` so the final section clearly states as hard workflow rules (not suggestions):
- your work is not complete until `aigon agent-status submitted` succeeds
- do not claim completion before that command succeeds
- if the command fails, report the exact error and stop — do not retry with `feature-submit`, `feature-close`, or any other command
- do not say "done", "complete", or "ready for review" until the signal succeeds

### 6. Keep submit semantics in the implemented CLI path

The actual implemented submit signal today is `aigon agent-status submitted` in `lib/commands/misc.js`. This feature does not replace that mechanism; it aligns all prompts, docs, and configs around it.

## Dependencies

- `templates/generic/commands/feature-submit.md` — delete
- `templates/generic/commands/feature-do.md`
- `templates/generic/docs/agent.md`
- `templates/generic/commands/help.md`
- `templates/generic/commands/next.md`
- `templates/help.txt`
- `templates/agents/cc.json`, `cx.json`, `gg.json`, `cu.json`
- `docs/agents/codex.md`, `claude.md`, `gemini.md`, `cursor.md`, `mistral-vibe.md`
- `lib/templates.js` — remove COMMAND_REGISTRY entry + `afsb` alias
- `lib/action-scope.js` — remove scope entry

## Out of Scope

- Reintroducing `feature-submit` as a real CLI handler
- Changing `research-submit`
- Changing feature-close, feature-eval, or research workflow semantics
- Changing the `agent-status submitted` implementation itself

## Open Questions

- Should `feature-do` include a short final self-checklist before the agent responds to the user?

## Related

- Feature: fix-autopilot-to-use-workflow-core-engine (autopilot also relies on `agent-status submitted` signal)
- `templates/generic/commands/feature-do.md`
- `templates/generic/docs/agent.md`
- `docs/agents/codex.md`
