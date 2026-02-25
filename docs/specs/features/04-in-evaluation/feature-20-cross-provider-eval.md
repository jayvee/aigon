# Feature 20: Cross-Provider Eval

## Summary

Reduce self-evaluation bias in `feature-eval` and `research-synthesize` by defaulting to a different model/provider than the one that produced the work being judged.

Research confirms LLM-as-judge bias is real and measurable: GPT-4 preferred its own outputs 87.76% of the time; Claude showed a 25% win rate inflation when judging its own work. The bias operates via perplexity familiarity — a model rates text in its own style higher even without knowing it produced it. This extends to family bias: Claude rates other Claude outputs higher too.

Today the user manually switches to Sonnet before running eval. This feature makes that automatic and more principled.

## User Stories

- [ ] As a developer running `feature-eval` on solo work, I want Aigon to warn me if I'm using the same model/family that implemented the feature
- [ ] As a developer, I want arena mode to automatically use a cross-provider judge when evaluating implementations
- [ ] As a developer, I want to explicitly override the eval model when I know what I'm doing

## Acceptance Criteria

- [ ] `feature-eval` uses the `evaluate` task type model (from Feature 19) when launching the eval agent
- [ ] In solo mode: if evaluator model family matches implementer model family, emit a warning and suggest a cross-provider alternative
- [ ] In arena mode: `feature-eval` defaults to a different agent/provider than the implementer (e.g. if `cc` implemented, suggest `gg` or `cx` as evaluator)
- [ ] `--allow-same-model-judge` flag suppresses the warning when the user explicitly wants same-model eval
- [ ] Warning includes the specific bias risk and a suggested command to use a different evaluator

## Technical Approach

### Same-Model Detection

When `feature-eval` launches, compare:
- The agent that produced the implementation (from the worktree/log metadata)
- The agent running the evaluation

If same agent (or same provider family), emit warning:

```
⚠️  Self-evaluation bias warning:
   Implementer: cc (Claude)
   Evaluator:   cc (Claude)

   Same-family evaluation inflates win rates by ~25% (MT-Bench, 2023).
   Consider: aigon feature-eval 55 --agent=gg
   Or suppress: aigon feature-eval 55 --allow-same-model-judge
```

### Arena Mode Default

In arena mode where multiple agents implemented, `feature-eval` already benefits from cross-provider judging naturally. Formalise this: the eval agent should be different from the majority implementer, or rotate providers.

### Provider Family Map

```javascript
const PROVIDER_FAMILIES = {
  cc: 'anthropic',
  cu: 'varies',  // Cursor proxies multiple providers
  gg: 'google',
  cx: 'openai',
};
```

Same-family check: `PROVIDER_FAMILIES[evalAgent] === PROVIDER_FAMILIES[implementAgent]`.

## Out of Scope

- Ensemble judging (multiple models scoring, then averaging) — future enhancement
- Position randomization in eval prompts — future enhancement
- Automatic selection of the "best" cross-provider judge

## Dependencies

- Feature 19: Model Selection Core (provides the `evaluate` task type and model injection)

## Related

- Feature 19: Model Selection Core
- Feature 21: Model Management Tooling
