---
name: aigon-research-context
description: Record or show a research author handoff
---

# aigon-research-context

Record the original author's durable, transcript-free handoff:

```bash
eval "$(aigon agent-context --shell)"
aigon research-context record $1 --file=<handoff.json>
```

The JSON must contain string arrays named `decisions`, `constraints`,
`nonGoals`, `unresolvedQuestions`, `implementationNotes`, and `specReferences`.
Put durable decisions in the spec first. Inspect the redacted artifact with
`aigon research-context show $1`.
