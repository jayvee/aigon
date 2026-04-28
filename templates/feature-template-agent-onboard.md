# Feature: onboard-agent-<id>

## Agent Identity

- **Agent ID**: `<id>`
- **Name**: `<name>`

## Decision Tree Answers

<!-- Replace the placeholders with your answers from the docs/adding-agents.md decision tree -->
1. **Prompt Delivery**: [Answer]
2. **Slash-command Support**: [Answer]
3. **--model Flag**: [Answer]
4. **Interactive vs Batch**: [Answer]
5. **Transcript Telemetry**: [Answer]

## templates/agents/<id>.json Checklist

<!-- Fill in the corresponding templates/agents/<id>.json fields based on your answers -->
- [ ] `id`: (Derived from Agent ID)
- [ ] `name`: (Derived from Agent Name)
- [ ] `launchType`: (Derived from Q1, Q2, Q4)
- [ ] `promptDelivery`: (Derived from Q1)
- [ ] `supportsSlashCommands`: (Derived from Q2)
- [ ] `supportsModelFlag`: (Derived from Q3)
- [ ] `sessionType`: (Derived from Q4)
- [ ] `telemetrySupport`: (Derived from Q5)

## docs/agents/<id>.md Checklist

- [ ] Create `docs/agents/<id>.md` detailing agent-specific commands, setup, and quirks.
- [ ] Document how to handle any unique flags or settings.

## Test Contract

<!-- Add this assertion block to tests/integration/worktree-state-reconcile.test.js -->
```javascript
// Test Contract for <id>
test('reconciles state for <id>', async () => {
  // Add agent-specific setup here
  // Add assertion ensuring correct launch behaviour
});
```

## Validation

<!-- Check that the agent can be launched via the brewboard smoke test -->
- [ ] Verify agent works with `aigon feature-start 01 <id>` on brewboard-seed.
