<!-- description: Start feature autonomous execution with explicit stop-after -->
# aigon-feature-autonomous-start

Start a feature in autonomous mode with explicit agent/evaluator choices and stop point control.

```bash
aigon feature-autonomous-start {{ARG_SYNTAX}} [agents...] [--workflow <slug>] [--eval-agent=<agent>] [--review-agent=<agent>] [--stop-after=implement|eval|review|close]
```

## Usage

```bash
# Solo: auto-close after implementation
aigon feature-autonomous-start {{ARG_SYNTAX}} cc

# Saved workflow: resolve agents/stop-after from a definition
aigon feature-autonomous-start {{ARG_SYNTAX}} --workflow solo-reviewed

# Fleet: run through eval then stop for manual winner selection
aigon feature-autonomous-start {{ARG_SYNTAX}} cc gg --eval-agent=gg --stop-after=eval

# Status
aigon feature-autonomous-start status {{ARG_SYNTAX}}
```

## Notes

- `--stop-after` defaults to `close`.
- `--workflow <slug>` loads saved agents and autonomous settings before applying explicit CLI overrides.
- Fleet `--stop-after=close` currently falls back to `eval` with an explanatory message.
- The command starts a dedicated AutoConductor tmux session (`{repo}-f{id}-auto(-desc)`) and exits immediately.
- AutoConductor failure is non-destructive; implementation/eval sessions continue and can be finished manually.
