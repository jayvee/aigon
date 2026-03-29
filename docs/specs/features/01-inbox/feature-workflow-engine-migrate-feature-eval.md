# Feature: workflow-engine-migrate-feature-eval

## Summary

Migrate `feature-eval` to use the workflow-core engine for features that were started via the engine. When a feature has engine state (from the migrated `feature-start`), eval transitions through `engine.requestFeatureEval()` with proper XState guard enforcement (`allAgentsReady`). Legacy features without engine state continue through the old `requestTransition` path.

## User Stories

- [ ] As a user running `feature-eval 42`, the engine validates that all agents have submitted before allowing the transition — no more eval on half-finished features
- [ ] As a user, the eval transition is recorded as an immutable event in the feature's event log
- [ ] As a user viewing the Events tab, the eval event shows with its timestamp and actor

## Acceptance Criteria

- [ ] `feature-eval` checks for engine state; if present, calls `engine.requestFeatureEval()`
- [ ] XState guard `allAgentsReady` is enforced — eval is rejected if any agent hasn't submitted
- [ ] Engine emits `feature.eval_requested` event and transitions to `evaluating` state
- [ ] Eval effects (move-spec to in-evaluation, write-eval-stub) run through the effect lifecycle
- [ ] Dashboard shows the feature in "in-evaluation" stage via snapshot adapter (already works)
- [ ] Legacy fallback via `requestTransition('feature-eval')` when no engine state exists
- [ ] Solo (Drive) mode: eval transition still works for single-agent features

## Validation

```bash
node --check lib/commands/feature.js
npm test
```

## Technical Approach

Create `lib/workflow-eval.js` following the bridge pattern. Simpler than start/close because eval has fewer side effects (spec move + eval stub). The key value-add is the XState guard — the engine will reject eval if agents aren't ready, which the legacy system doesn't enforce rigorously.

### Guard enforcement

The engine's XState machine requires `allAgentsReady` guard to pass. This means all agents in the feature must have status `ready` (submitted). The bridge needs to ensure agent signals (`signal.agent_ready`) have been emitted before eval can proceed. If the feature was started via the engine but agents submitted through the legacy path, the bridge may need to synthesize `signal.agent_ready` events from manifest agent status files.

## Dependencies

- depends_on: workflow-engine-migrate-feature-start

## Out of Scope

- Fleet vs Drive eval mode differences (keep existing logic)
- The `--allow-same-model-judge` flag (keep as-is)
- Changing how the eval agent is launched

## Open Questions

- How to handle the transition period where features are engine-started but agents submit via legacy status files?

## Related

- `lib/workflow-core/engine.js` — `requestFeatureEval()`
- `lib/workflow-core/machine.js` — `allAgentsReady` guard
- `lib/workflow-close.js` — bridge pattern reference
