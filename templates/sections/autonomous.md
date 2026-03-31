To run in **Autopilot mode** — autonomous retry loop where a fresh agent session is spawned each iteration until validation passes:

```bash
aigon feature-do {{ARG1_SYNTAX}} --autonomous
```

Optional flags: `--max-iterations=N` (default 5) · `--agent=<id>` · `--dry-run`

> **What is autonomous mode?** The autonomous technique runs an agent in a loop: implement → validate → if fail, repeat with fresh context until success or max iterations. Add a `## Validation` section to your feature spec to define feature-specific checks alongside project-level validation.