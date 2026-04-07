# Feature: create-with-agent

## Summary

Add an `--agent <id>` flag to `aigon feature-create` that launches the named agent (cc, gg, cx, or cu) **interactively** with pre-loaded drafting context, so the user and the agent can collaboratively flesh out a feature spec from a short description. The agent doesn't run one-shot — it starts a real conversation where the user can answer clarifying questions, push back on suggestions, iterate on the user stories and acceptance criteria, and only save/exit when they're satisfied. Nothing is committed, no branch is created; the feature stays in `01-inbox/` until the user decides to prioritise it.

## Why interactive and not one-shot?

An earlier draft of this spec proposed a headless one-shot invocation where the agent would read the description and dump a full spec in a single pass. That was wrong for two reasons:

1. **Generic output.** Good feature specs get their nuance from back-and-forth. "What about the empty state?" "Should this persist across sessions?" "Do we care about existing users who already have data?" One-shot prompts produce checklist-filler specs that miss these, because the model has no opportunity to ask.
2. **Loss of user judgment.** The whole point of drafting a spec with an AI is to bounce ideas off it, correct its assumptions, and shape the direction together. One-shot bypasses that entirely — you get whatever the model's first instinct was, with no steering.

The interactive model is the same pattern we already use successfully with `/aigon:feature-now` inside Claude Code: open the agent, load the context, converse, exit when done. The only difference here is that the entry point is `aigon feature-create --agent cc` on the CLI instead of a slash command inside an already-running agent session.

## Recommended syntax

Flags come **right after the feature name**, before the description. Keeps the agent choice scannable even when the description is long:

```bash
aigon feature-create <name> --agent <id> "<short description>"
```

Example:

```bash
aigon feature-create beer-colour --agent cc "add a colour label and filter by colour"
```

The parser accepts flags in any order (so trailing `--agent` still works), but documentation and examples consistently use the name → flags → description order.

## User Stories

- [ ] As a user at the CLI, I can run `aigon feature-create beer-colour --agent cc "every beer needs a colour label and filter"` and land straight into a Claude Code session with the bare spec open and the drafting context pre-loaded — no copy-pasting, no manual setup.
- [ ] As a user collaborating with the agent, I can answer clarifying questions, push back on proposed user stories, and iterate on the spec until I'm satisfied, then exit the session cleanly.
- [ ] As a user who prefers one agent over another for spec drafting, I can pick which agent leads the drafting via the `--agent` flag.
- [ ] As a user reviewing the drafted spec after the session ends, I can trust that nothing has been committed, no branch has been created, and the feature is still in inbox — ready for me to edit further, reject, or prioritise.
- [ ] As a user whose agent session gets interrupted (accidental exit, crash, etc.), I can see that the spec file is still there in inbox with whatever was drafted up to that point, and I can either re-run `feature-create --agent` or finish the spec manually.

## Acceptance Criteria

- [ ] **AC1** — `aigon feature-create <name> --agent cc "<description>"` creates the bare spec AND launches Claude Code as an interactive session in the current terminal, with the drafting context message sent as the opening turn of the conversation. Same for `--agent gg`, `--agent cx`, `--agent cu`.
- [ ] **AC2** — The agent session runs in the foreground, attached to the user's terminal (`stdio: 'inherit'`). The user's terminal IS the agent's terminal — they can type, the agent responds, standard agent CLI behavior.
- [ ] **AC3** — The opening context message clearly tells the agent: what file to edit, where the user's description lives, what sections to draft (User Stories, Acceptance Criteria, Technical Approach), and what NOT to do (no commits, no branches, no implementation).
- [ ] **AC4** — The feature file stays in `docs/specs/features/01-inbox/`. No git commit, no branch creation, no prioritise, no state machine transitions — the workflow engine is not invoked.
- [ ] **AC5** — `--agent` requires a description. If no description is provided, the command fails fast with a clear error: "A description is required when using --agent — pass it positionally or via --description."
- [ ] **AC6** — If the named agent CLI is not in PATH, the command fails fast: `Agent 'cc' requires the \`claude\` CLI on your PATH. Install with: brew install claude-code`. The bare spec is still created (same as if `--agent` wasn't passed).
- [ ] **AC7** — When the agent session exits (user types `/exit` or equivalent), control returns to the shell and aigon prints a short summary: which sections of the spec are now populated, the file path, and the next-step command (`aigon feature-prioritise <name>`).
- [ ] **AC8** — If the spec file has NOT changed after the agent session exits (file size/mtime/hash unchanged from the bare template), aigon warns the user: "⚠️  The spec file was not modified — did the drafting session complete successfully? The bare spec is still at <path> for you to fill in manually or retry."
- [ ] **AC9** — Existing `aigon feature-create` behaviour is unchanged when `--agent` is NOT passed. No regression to the simple flow.
- [ ] **AC10** — Regression test (within the test budget): a source-level assertion that `lib/commands/feature.js` parses `--agent` and routes to an interactive-launch dispatcher (not a one-shot exec).

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/agent-registry.js
npm test

# Manual end-to-end (requires at least one agent CLI installed):
cd /tmp && mkdir aigon-test && cd aigon-test && git init && aigon init
aigon feature-create smoke-test --agent cc "a smoke test feature to verify interactive drafting"
# You land in Claude Code. Have a short conversation. Exit.
cat docs/specs/features/01-inbox/feature-smoke-test.md
# Expect: User Stories, Acceptance Criteria, Technical Approach populated
# Expect: file still in 01-inbox/, no commits, no branches
```

## Technical Approach

### 1. Arg parsing (flag-aware)

Rewrite the `feature-create` handler in `lib/commands/feature.js` to extract flags before positional args. The current naive parser (from commit `db3dd5de`) treats `args.slice(1)` as the description, which would wrongly swallow `--agent cc`. The fix:

1. Take `args[0]` as the name
2. Walk the remaining args, extracting recognized flag pairs (`--agent <id>`, `--description <text>`, and any future `--foo <bar>`) into a flags map
3. Whatever positional args are left after flag extraction become the description (joined with spaces)

This lets all of these work equivalently:

```bash
aigon feature-create beer-colour --agent cc "add a colour filter"        # recommended order
aigon feature-create beer-colour "add a colour filter" --agent cc        # trailing flag
aigon feature-create beer-colour --agent cc --description "add filter"   # both flags
aigon feature-create beer-colour add a colour filter                     # no agent, positional
```

Validate the agent ID against `getAllAgentIds()` from `lib/agent-registry.js` and error cleanly if unknown.

### 2. Agent dispatcher — interactive launch

After creating the bare spec, if `--agent` is set, launch the agent as an interactive subprocess with the drafting context as the opening message, attached to the user's TTY:

```js
const { spawnSync } = require('child_process');

function draftSpecWithAgentInteractive(specPath, agentId) {
    const agent = getAgentById(agentId);                  // from agent-registry
    const cliBin = agent.cli.binary;                      // 'claude', 'gemini', 'codex', 'cursor-agent'
    ensureBinaryOnPath(cliBin);                           // hard error if missing

    const contextMessage = buildDraftContextMessage(specPath);
    const launchArgs = buildAgentLaunchArgs(agent, contextMessage);
    // e.g. for cc: [contextMessage]
    //      for cx: ['exec', contextMessage] — TBD, verify at impl time

    // Record file state BEFORE the session
    const beforeHash = hashFile(specPath);

    // spawnSync with stdio: 'inherit' gives the child process the real TTY.
    // The user's terminal becomes the agent's terminal until the agent exits.
    const result = spawnSync(cliBin, launchArgs, {
        stdio: 'inherit',
        cwd: process.cwd(),
    });

    // Record file state AFTER
    const afterHash = hashFile(specPath);

    if (beforeHash === afterHash) {
        console.warn(`⚠️  The spec file was not modified during the session.`);
        console.warn(`   The bare spec is still at ${specPath}.`);
        console.warn(`   You can re-run with --agent, or fill it in manually.`);
    } else {
        reportDraftChanges(specPath, beforeHash, afterHash);
        console.log(`\n✓ Spec drafted. Next: aigon feature-prioritise ${nameFromPath(specPath)}`);
    }

    return result.status;
}
```

Key points:
- **`stdio: 'inherit'`** — the agent gets the real terminal, the user can type and see normally. Interactive mode.
- **No timeout** — conversations take as long as they take. The user is driving.
- **No stderr capture** — all output goes straight to the user's terminal, same as if they'd run the agent manually.
- **Post-session check** — hash the file before and after; if unchanged, warn. That's our only signal that something might have gone wrong.

### 3. Drafting context message

The opening message sent to the agent at session start. Stored in `templates/prompts/feature-draft.md` (new file), interpolated with the spec path:

```
You're helping me draft a feature spec for this Aigon project.

The bare spec file is at:
  {{SPEC_PATH}}

I've put my short description in the Summary section. Please read it and the
rest of the template, then let's work through this together:

1. Ask me any clarifying questions you need to really understand what I'm
   trying to build. Don't guess — if there's ambiguity, call it out.
2. Propose the User Stories, Acceptance Criteria, and Technical Approach.
   Show them to me in the chat FIRST so I can push back before you write
   anything to the file.
3. When I'm happy with a section, write it into the file. Iterate as we go.
4. When I say we're done, save the final version of the file and confirm
   what you changed. I'll exit the session when I'm ready.

Do NOT:
- Run any commands or shell operations
- Create branches or commit anything
- Run feature-prioritise or feature-start
- Implement the feature — we're only drafting the spec, not building it
- Change the spec filename

Ready? Start by reading the file and summarizing your understanding of
what I want. Then ask me your clarifying questions.
```

Tone-wise: collaborative, gives the agent permission to ask questions and push back, sets hard limits on what it should NOT do, makes the user the driver.

### 4. Agent registry extension

`templates/agents/{cc,gg,cx,cu}.json` need a new field describing how each agent accepts an **interactive** initial message (different from one-shot):

- `cc` (Claude Code): `claude "<initial message>"` — verify at impl time whether the positional arg starts an interactive session with that message pre-sent, or if a different flag is needed
- `gg` (Gemini CLI): TBD — verify
- `cx` (Codex CLI): TBD — verify whether `codex "<msg>"` starts interactive with that message
- `cu` (Cursor): `cursor-agent "<initial message>"` — verify

If an agent genuinely can't accept a pre-loaded initial message (i.e. it ALWAYS opens a blank session), the implementer has a fallback: write the context message to a temp file, print instructions like "Copy this prompt into your agent: `cat /tmp/aigon-draft-prompt-<slug>.md`", and spawn the agent with no initial message. Ugly but works. Document the fallback per-agent in the agent config.

### 5. Error handling and UX

- **Missing binary**: hard error before launching, point at install docs. Bare spec already created so the user can still work manually.
- **Agent session exits with non-zero status**: aigon reports it but doesn't treat it as hard failure — the spec file state is the source of truth. If the user exited cleanly after saving changes, the spec is fine even if the agent's exit code is nonzero.
- **Spec file unchanged after session**: warn the user (AC8). Possible causes: agent crashed, user exited early, agent didn't understand the prompt. User decides next step.
- **Spec file looks incomplete** (e.g. still has template comments in User Stories): don't try to detect this — trust the user's judgment. They saw the conversation.
- **User interrupts with Ctrl+C**: the interrupt goes to the agent first (since it has the TTY), agent handles or dies, control returns to aigon which checks the file and reports.

### 6. Test coverage

Within the test budget:
- Source-level assertion that `--agent` is parsed and routes to the interactive dispatcher (matches the existing `worktree-config-isolation.test.js` source-regression pattern)
- Source-level assertion that `spawnSync` is called with `stdio: 'inherit'` (regression guard against someone accidentally using `execSync` or `spawn` without `inherit`)
- Unit test for `buildDraftContextMessage()` that `{{SPEC_PATH}}` substitution works

Integration testing is hard because it needs a real agent CLI with interactive TTY. Document this as a manual-test-only path in the spec's Validation section.

## Dependencies

- None — pure addition to `feature-create`
- Relies on existing `lib/agent-registry.js` for agent lookup
- Relies on existing agent CLIs being installable separately (cc, gg, cx, cu)

## Out of Scope

- **Multi-line description input from the CLI.** The `--agent` flow accepts a short description as a positional one-liner or `--description "text"` — no editor mode, no `--description-file`, no stdin input. The conversation inside the agent session handles multi-line input natively, so the CLI-side description is deliberately kept to a one-line seed.
- **Multi-agent fleet drafting** — single agent only. Fleet mode is for implementation, not spec drafting.
- **Editing an existing spec** — `--agent` only works with `feature-create`. No `feature-rewrite --agent cc` for polishing specs already in backlog or in-progress. Could be a follow-up feature `feature-draft <id>`.
- **Autonomous prioritise or start** — the drafted spec stays in inbox, full stop. User is the gate.
- **Timeouts or supervision of the conversation** — the user is driving, the session runs until the user exits.
- **Prompting the user for a description** if none is provided — error out instead, keep the flow script-friendly.
- **Customising the prompt** per user — the prompt template is shipped with aigon. Users who want a different prompt edit `templates/prompts/feature-draft.md` after install.
- **Committing the draft for the user** — no git operations at all. User decides what to commit.
- **Non-English prompts** — English only for v1.

## Open Questions

- **Exact interactive-launch pattern per agent**: does `claude "msg"` start interactive mode with the message pre-sent, or does it run one-shot? Needs verification against each agent's current version before/during implementation.
- **Fallback when an agent can't pre-load a message**: is the "copy this prompt" fallback acceptable, or should we drop agents that can't do pre-loaded interactive context? Recommend keeping the fallback — ugly but lets us support every agent.
- **Should there be a dry-run mode** (`--dry-run`) that prints the context message without launching the agent? Useful for debugging the prompt. Low cost to add. Recommend yes.
- **If the user passes `--agent cc` but cc isn't in `.aigon/config.json`'s active agents**: still work? Yes — `--agent` is a one-off override.
- **Short flag alias** `-a cc`? Defer — we don't use short flags elsewhere in aigon.
- **Follow-up feature**: `feature-draft <id>` to open an interactive drafting session on an EXISTING inbox spec. Not in scope here, but a natural next step.

## Related

- `lib/commands/feature.js` — where `feature-create` lives
- `lib/entity.js` — where `entityCreate` handles the template substitution (the recent regex fix lives here)
- `lib/agent-registry.js` — agent metadata lookup
- `templates/agents/*.json` — per-agent config (needs interactive-launch field)
- `templates/specs/feature-template.md` — the bare spec the agent fills in
- `templates/prompts/feature-draft.md` — the drafting context message (new file to add)
- Existing slash command `/aigon:feature-now` — the in-agent equivalent that inspired this CLI version; same interactive model, different entry point
- Commit `db3dd5de` — the prerequisite fix that made positional description work on `feature-create`
