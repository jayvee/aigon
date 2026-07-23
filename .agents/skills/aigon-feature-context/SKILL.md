---
name: aigon-feature-context
description: Record or show a feature author handoff
---

# aigon-feature-context

Record the original author's durable, transcript-free handoff:

```bash
eval "$(aigon agent-context --shell)"
aigon feature-context record $1 --file=<handoff.json>
```

The JSON must contain string arrays named `decisions`, `constraints`,
`nonGoals`, `unresolvedQuestions`, `implementationNotes`, and `specReferences`.
Put durable decisions in the spec first; references should name those current
spec sections. Inspect the redacted artifact with:

```bash
aigon feature-context show $1
```
