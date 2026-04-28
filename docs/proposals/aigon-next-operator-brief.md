# Aigon Next Operator Brief

Use this as the short handoff prompt for a new Codex session in a separate prototype repo such as `~/src/aigon-next`.

## Read First

Read this file for the brief:

- `/Users/jviner/src/aigon/docs/proposals/aigon-next-operator-brief.md`

Then read the full bootstrap:

- `/Users/jviner/src/aigon/docs/proposals/aigon-next-prototype-bootstrap.md`

Optional background:

- `/Users/jviner/src/aigon/AGENTS.md`
- `/Users/jviner/src/aigon/docs/architecture.md`
- `/Users/jviner/src/aigon/docs/development_workflow.md`

## Prompt

```text
Build a proof-of-concept for a new Aigon workflow core in this repo.

Read these files from the current Aigon repo first:
- /Users/jviner/src/aigon/docs/proposals/aigon-next-operator-brief.md
- /Users/jviner/src/aigon/docs/proposals/aigon-next-prototype-bootstrap.md

This prototype should:
- use XState
- use local file-backed persistence only
- avoid any database
- run as a standalone CLI against external target repos
- support a narrow feature workflow vertical slice only
- derive available actions from machine-valid events
- include an optional orchestrator concept, but no dashboard initially

Start with the smallest useful end-to-end implementation:
- feature-start
- agent-ready signal
- actions query
- feature-eval
- select-winner
- feature-close

Run the prototype against external seed repos via a `--repo` flag instead of deeply installing into them.

Keep the implementation intentionally narrow and architecturally clean.
Do not port all of Aigon. Prove the new core model first.
```

## Success Criteria

The prototype is successful if:

1. A feature can run in `solo_branch`, `solo_worktree`, and `fleet`.
2. Workflow truth is stored only in local files.
3. Manual actions are derived from machine-valid events.
4. A hung or silent agent is recoverable with explicit actions.
5. Interrupted operations can resume cleanly.
6. An optional orchestrator can emit signals without becoming the source of truth.

