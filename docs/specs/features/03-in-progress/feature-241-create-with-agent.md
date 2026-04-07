# Feature: create-with-agent

## Summary

Add an `--agent <id>` flag to `aigon feature-create` that launches the named agent (cc, gg, cx, or cu) to flesh out the bare spec from a short description. The agent writes the user stories, acceptance criteria, and technical approach sections, saves the result, and exits. Feature stays in `01-inbox/` for user review before prioritising. Closes the gap between "describe a feature on the CLI" and "feature spec ready to prioritise" without requiring the user to be inside an agent first.

## Recommended syntax

Flags come **right after the feature name**, before the description. This keeps the agent choice scannable even when the description is long:

```bash
aigon feature-create <name> --agent <id> "<short description>"
```

Example:

```bash
aigon feature-create beer-colour --agent cc "add a colour label and filter by colour"
```

The parser still accepts flags in any order (so the existing `aigon feature-create beer-colour "..." --agent cc` keeps working), but documentation and examples consistently use the name → flags → description order.

## User Stories

- [ ] As a user at the CLI, I can run `aigon feature-create beer-colour --agent cc "every beer needs a colour label and filter"` and get a fleshed-out spec within a minute, without having to open Claude Code first.
- [ ] As a user who prefers one agent over another for spec drafting, I can pick which agent does the drafting via the `--agent` flag.
- [ ] As a user whose agent CLI fails mid-drafting, I can see a clear error and still have the bare spec in inbox to fill in manually or retry.
- [ ] As a user reviewing AI-drafted specs, I can trust that nothing has been committed, no branch has been created, and the feature is still in inbox — ready for me to edit or reject without cleanup.

## Acceptance Criteria

- [ ] **AC1** — `aigon feature-create <name> <description...> --agent cc` creates the bare spec AND launches Claude Code headless/one-shot to flesh it out. Same for `--agent gg`, `--agent cx`, `--agent cu`.
- [ ] **AC2** — The resulting spec has non-empty User Stories (2–4 items), Acceptance Criteria (4–8 items), and Technical Approach (1–2 paragraphs) sections. The other template sections (Validation, Dependencies, Out of Scope, Open Questions, Related) can remain as bare template placeholders.
- [ ] **AC3** — The feature file stays in `docs/specs/features/01-inbox/`. No git commit, no branch creation, no prioritise, no state machine transitions — the workflow engine is not invoked.
- [ ] **AC4** — `--agent` requires a description. If no description is provided, the command fails fast with a clear error: "A description is required when using --agent — pass it positionally or via --description."
- [ ] **AC5** — If the named agent CLI is not in PATH, the command fails fast: `Agent 'cc' requires the \`claude\` CLI on your PATH. Install with: brew install claude-code`. The bare spec is still created (same as if `--agent` wasn't passed).
- [ ] **AC6** — If the agent exits non-zero or times out (default 5 min), the command prints a clear error with the agent's stderr, the bare spec remains in inbox, and the user can retry or fill manually.
- [ ] **AC7** — The command prints progress: `Creating bare spec... ✓`, `Launching cc to draft spec (timeout 5 min)...`, `Drafting complete: 3 user stories, 6 acceptance criteria, 2-paragraph technical approach`.
- [ ] **AC8** — Existing `aigon feature-create` behaviour is unchanged when `--agent` is NOT passed. No regression to the simple flow.
- [ ] **AC9** — Regression test (within the test budget): a source-level assertion that `lib/commands/feature.js` parses `--agent` and routes to a dispatcher function.

## Validation

```bash
node --check lib/commands/feature.js
node --check lib/agent-registry.js
npm test

# Manual end-to-end (requires at least one agent CLI installed):
cd /tmp && mkdir aigon-test && cd aigon-test && git init && aigon init
aigon feature-create smoke-test --agent cc "a smoke test feature to verify agent drafting"
cat docs/specs/features/01-inbox/feature-smoke-test.md
# Expect: User Stories, Acceptance Criteria, Technical Approach all populated
```

## Technical Approach

### 1. Arg parsing

Extend the `feature-create` handler in `lib/commands/feature.js`. The parser needs a small rewrite to be flag-aware so the positional description doesn't accidentally swallow flag values:

1. Take `args[0]` as the name
2. Walk the remaining args, extracting any recognized flag pairs (`--agent <id>`, `--description <text>`, any future `--foo <bar>`) into a flags map
3. Whatever positional args are left after flag extraction become the description (joined with spaces)

This lets all of these work equivalently:

```bash
aigon feature-create beer-colour --agent cc "add a colour filter"        # recommended order
aigon feature-create beer-colour "add a colour filter" --agent cc        # trailing flag
aigon feature-create beer-colour --agent cc --description "add filter"   # both flags
aigon feature-create beer-colour add a colour filter                     # no agent, positional
```

Validate the agent ID against `getAllAgentIds()` from `lib/agent-registry.js` and error cleanly if unknown. The current `feature-create` handler (from commit `db3dd5de`) is naive about flag extraction — it treats `args.slice(1)` as the description when `--description` isn't present — which would wrongly include `--agent cc` as description words. Rewrite to the walk-and-extract approach above.

### 2. Agent dispatcher

New function in `lib/commands/feature.js` (or a small helper module like `lib/feature-create-draft.js`):

```js
async function draftSpecWithAgent(specPath, agentId) {
    const agent = getAgentById(agentId);           // from agent-registry
    const cliBin = agent.cli.binary;               // e.g. 'claude', 'gemini', 'codex'
    const oneShotFlag = agent.cli.oneShotFlag;     // e.g. '--print', '-p', 'exec'
    ensureBinaryOnPath(cliBin);                    // hard error if missing
    const prompt = buildDraftPrompt(specPath);
    execSync(`${cliBin} ${oneShotFlag} ${shellQuote(prompt)}`, {
        timeout: 5 * 60 * 1000,
        stdio: ['ignore', 'pipe', 'pipe']
    });
    verifyDraftWasApplied(specPath);               // spec actually changed
}
```

### 3. Prompt template

Shared across agents. Stored in `templates/prompts/feature-draft.md`:

```
You are helping draft a feature spec for an Aigon project.

The bare spec is at: {{SPEC_PATH}}

The user has filled in the Summary section with a short description. Read
it, then edit the file in place to fill in these sections:

- User Stories: 2-4 specific, user-focused stories in
  "As a ..., I want ..., so that ..." form.
- Acceptance Criteria: 4-8 testable AC items, numbered AC1, AC2, etc.
- Technical Approach: 1-2 short paragraphs on how to implement this
  feature, referencing relevant files in the codebase if obvious.

Leave these sections exactly as they are (bare template placeholders):
Validation, Dependencies, Out of Scope, Open Questions, Related.

Do NOT:
- Run any commands
- Create branches
- Commit anything
- Change the spec filename
- Run feature-prioritise or feature-start

Just edit the file in place and exit.
```

### 4. Agent registry extension

`templates/agents/{cc,gg,cx,cu}.json` need a new field describing how to run each agent headless/one-shot:

- `cc` (Claude Code): `claude --print "<prompt>"` — verify the actual flag against the current CLI version before implementation.
- `gg` (Gemini CLI): one-shot mode flag — verify.
- `cx` (Codex CLI): `codex exec "<prompt>"` — Codex supports `exec` for one-shot.
- `cu` (Cursor): `cursor-agent run "<prompt>"` — verify.

The exact CLI flags need to be confirmed against each agent's current version before the feature is started. That check is part of the implementation, not a blocker upfront.

### 5. Error handling and UX

- **Missing binary**: hard error before launching, point at install docs
- **Timeout**: kill the agent, print partial stderr, leave bare spec, exit non-zero
- **Non-zero exit**: print stderr, leave bare spec, exit non-zero
- **Agent edits the spec but it's still mostly empty**: warn that the draft looks incomplete, let the user decide
- **Dry run mode** (optional): `--agent cc --dry-run` prints the prompt that would be sent without invoking the agent

### 6. Test coverage

- Source-level assertion that `--agent` is parsed and routed (fits the existing `worktree-config-isolation.test.js` source-regression pattern)
- Unit test for `buildDraftPrompt()` that it substitutes `{{SPEC_PATH}}` correctly
- Optional: a mock-agent integration test that produces a known draft output in a temp spec and verifies the file gets edited. Scope depending on test budget headroom at the time.

## Dependencies

- None — pure addition to `feature-create`
- Relies on existing `lib/agent-registry.js` for agent lookup
- Relies on existing agent CLIs being installable separately (cc, gg, cx, cu)

## Out of Scope

- **Multi-line description input from the CLI.** The `--agent` flow accepts a short description as a positional one-liner or `--description "text"` — no editor mode, no `--description-file`, no stdin input. For longer or multi-line descriptions, users have two better options: (1) create the bare spec with `aigon feature-create <name>` and edit the file directly in their editor of choice, or (2) use `/aigon:feature-now <name>` inside Claude Code (or equivalent slash commands in other agents), which handles multi-line chat input natively with zero shell-escaping friction. The CLI `--agent` flow is deliberately scoped to the "I want a one-liner fleshed out into a proper spec" use case.
- **Multi-agent fleet drafting** (two agents racing on the same spec draft) — single agent only. Fleet mode is for implementation, not spec drafting.
- **Editing an existing spec** — `--agent` only works with `feature-create`. No `feature-rewrite --agent cc` for polishing specs already in backlog or in-progress. Could be a follow-up feature `feature-draft <id>`.
- **Autonomous prioritise or start** — the drafted spec stays in inbox, full stop. User is the gate.
- **Prompting the user for a description** if none is provided — error out instead, keep the flow non-interactive and script-friendly.
- **Customising the prompt** per user — the prompt template is shipped with aigon. Users who want a different prompt edit `templates/prompts/feature-draft.md` after install.
- **Committing the draft for the user** — no git operations at all. User decides what to commit.
- **Non-English prompts** — English only for v1.

## Open Questions

- Default timeout: 5 minutes or 10? 5 is probably enough for a spec draft but edge cases could take longer. Default to 5, expose as `AIGON_DRAFT_TIMEOUT` env var for override.
- Should failed drafts leave a `.draft-error` marker file next to the spec so the user knows the state? Probably not — noisy. Print the error and trust the user to notice.
- If the user passes `--agent cc` but cc isn't listed in `.aigon/config.json`'s active agents for the project, should it still work? Yes — `--agent` is a one-off override, not a config change.
- Short flag alias `-a cc`? Feels useful but we don't use short flags elsewhere in aigon. Defer.
- Should there be a separate `feature-draft <id>` command for fleshing out an existing inbox spec that was created without `--agent`? Cleaner than retrofitting `feature-create --agent` for existing specs. Good follow-up.

## Related

- `lib/commands/feature.js` — where `feature-create` lives
- `lib/entity.js` — where `entityCreate` handles the template substitution (the recent regex fix lives here)
- `lib/agent-registry.js` — agent metadata lookup
- `templates/agents/*.json` — per-agent config (needs `cli.oneShotFlag` extension)
- `templates/specs/feature-template.md` — the bare spec the agent fills in
- Existing slash command `/aigon:feature-now` — the in-agent equivalent that inspired this CLI version
- Commit `db3dd5de` — the prerequisite fix that made positional description work on `feature-create`, which this feature builds on
