# aigon-feature-context

Record the original author's durable, transcript-free handoff:

```bash
eval "$(aigon agent-context --shell)"
aigon feature-context record <name> --file=<handoff.json>
```

The JSON must contain string arrays named `decisions`, `constraints`,
`nonGoals`, `unresolvedQuestions`, `implementationNotes`, and `specReferences`.
Put durable decisions in the spec first; references should name those current
spec sections. Inspect the redacted artifact with:

```bash
aigon feature-context show <name>
```
