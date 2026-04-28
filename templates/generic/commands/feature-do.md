<!-- description: Do feature <ID> - works in both Drive and Fleet modes -->
# aigon-feature-do

> **RUN THIS FIRST — no preamble, no --help, no file searches:**
> ```bash
> aigon feature-do {{ARG1_SYNTAX}}
> ```
> This prints the feature spec inline. Read the output, then follow the steps below.
> Do NOT search for spec files, do NOT run `aigon --help`, do NOT run `./aigon-cli.js`. Just run the command above.

Implement a feature. Works in Drive mode (branch), Drive worktree, and Fleet mode (competition).

> **Worktree invariant:** you are already inside the correct repo. If `aigon` fails, read the error — do NOT hunt for `aigon-cli.js`.

## Argument Resolution
If no ID is provided or it doesn't match an active feature, run `aigon feature-list --active`, filter to matches, and ask the user which one.

## Step 1: Attach to the workspace

```bash
aigon feature-do {{ARG1_SYNTAX}}
```

Only run `{{CMD_PREFIX}}feature-start {{ARG1_SYNTAX}}` if the feature branch/worktree does not exist yet.

{{AUTONOMOUS_SECTION}}

{{TROUBLESHOOTING_SECTION}}

## Step 2: Read the spec (already inlined)

The spec body was printed inline by `feature-do` above. **Use that copy.** Do not re-read from disk and do not re-run `aigon feature-spec` — the inline copy is authoritative.

{{PLAN_MODE_SECTION}}

{{SET_CONTEXT_SECTION}}

{{RESEARCH_CONTEXT_SECTION}}

{{PLANNING_CONTEXT_SECTION}}

{{WORKTREE_DEP_CHECK}}

## Step 3: Implement

Signal that you are starting (shell command only — do not write `.aigon/state/` files directly):
```bash
aigon agent-status implementing
```

**TIME BUDGET: under 10 minutes.**
- Start coding within 60 seconds. The spec IS your plan.
- Read ONLY files listed in the spec's Technical Approach / Key Files section.
- Do not create test files unless the spec explicitly requires them.
- **COMMIT EARLY AND OFTEN.** After every meaningful change: `git add -A && git commit -m "wip: <what you just did>"`. Never more than 2 minutes of uncommitted work.
- Use **relative paths** from the current worktree. Never absolute paths.
- Run shell commands directly; don't delegate simple commands (`npm test`, `node -c file.js`, validation batches) to sub-agents.

**Before stopping on a policy gate (test budget, security warning, ambiguous criterion):** check the spec's `## Pre-authorised` section. If the gate matches a listed line, proceed and include a commit footer `Pre-authorised-by: <slug-of-preauth-line>` citing which line authorised it. If no line matches, stop and ask as normal.

**Scope guardrails — read before editing:**
- Do not delete, move, or modify files unrelated to your feature spec. If existing code conflicts with your feature, document it in your log — do not remove it.
- Do not delete any test files. Do not remove existing function exports.
- Do not move spec files between folders — only the CLI manages spec state transitions.
- If you must touch a file outside your feature's area, note it explicitly in your implementation log with the reason.

Work through the acceptance criteria in order.

## Step 4: Commit your implementation

Stage and commit using conventional commits (`feat:`, `fix:`, `chore:`). Verify with `git log --oneline -1`.

{{TESTING_WRITE_SECTION}}

{{TESTING_RUN_SECTION}}

{{TESTING_STEPS_SECTION}}

{{DOCUMENTATION_SECTION}}

{{LOGGING_SECTION}}

{{DEV_SERVER_SECTION}}

## Step 5: Signal completion

After committing, run **immediately**:

```bash
aigon agent-status implementation-complete
```

Hard rules:
- Implementation is **not** complete until this succeeds. Don't say "done" before it exits 0.
- If it fails, report the exact error output and stop for user guidance. Don't substitute `feature-close` or other commands.
- Ship within 60 seconds of green tests — don't re-run validation "to be sure" or pre-expand the log.

After it succeeds, tell the user: "Implementation complete — ready for review."

**STAY in the session.** If the user requests changes, make them, commit, and say "Changes committed."

Do **not** run `feature-close` or `feature-eval` — that's the user's decision. In Drive mode the recommended next command is `{{CMD_PREFIX}}feature-close <ID>`; in worktree/Fleet modes, wait for the user.
