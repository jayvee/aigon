# Feature 21: Model Management Tooling

## Summary

Operational tooling for managing model configuration: env var overrides, a CLI subcommand to view and set models, doctor checks for invalid IDs, and documentation of the model selection workflow.

These are the "last mile" features that make the model config introduced in Feature 19 easy to inspect, debug, and override without editing JSON files.

## User Stories

- [ ] As a developer, I want to see which model Aigon will use for each task type without digging through config files
- [ ] As a developer, I want to override the research model for a single run via env var without changing my config
- [ ] As a developer, I want `aigon doctor` to tell me if any configured model IDs are invalid or unsupported
- [ ] As a developer, I want documentation of the model strategy so I understand the defaults and how to change them

## Acceptance Criteria

### Env Var Overrides
- [ ] `AIGON_CC_RESEARCH_MODEL`, `AIGON_CC_IMPLEMENT_MODEL`, `AIGON_CC_EVALUATE_MODEL` override config for one-off runs
- [ ] Pattern: `AIGON_{AGENT}_{TASKTYPE}_MODEL` (uppercase agent ID and task type)
- [ ] Env vars take highest precedence: env > project config > global config > template default
- [ ] `aigon config get cc` shows resolved model per task type and which level resolved it (provenance)

### Config CLI
- [ ] `aigon config models` shows current resolved model config for all agents and task types in a table
- [ ] `aigon config set cc.models.research opus` sets a value in global config
- [ ] `aigon config set --project cc.models.implement sonnet` sets a value in project config

### Doctor Checks
- [ ] `aigon doctor` (or `aigon doctor models`) validates configured model IDs per agent
- [ ] Checks that `--model` flag is supported by the agent CLI (e.g. warns for Cursor)
- [ ] Reports unknown/deprecated model IDs with suggestions

### Documentation
- [ ] `docs/agents/claude.md` (and equivalents) updated with model selection section
- [ ] Development workflow doc updated with model strategy guidance (research=opus, implement=sonnet, evaluate=cross-provider)

## Technical Approach

### Env Var Resolution

Add to `getAgentCliConfig()` after project/global/template merge:

```javascript
const envKey = `AIGON_${agentId.toUpperCase()}_${taskType.toUpperCase()}_MODEL`;
const envModel = process.env[envKey];
if (envModel) resolvedModels[taskType] = envModel;
```

### `aigon config models` Output

```
Model configuration (resolved):

Agent  Task        Model              Source
─────  ──────────  ─────────────────  ──────────────
cc     research    claude-opus-4-6    global config
cc     implement   claude-sonnet-4-6  template default
cc     evaluate    claude-sonnet-4-6  template default
gg     research    gemini-2.5-pro     template default
gg     implement   gemini-2.5-pro     template default
gg     evaluate    gemini-2.5-flash   template default
cx     research    (none — CLI default)
cx     implement   (none — CLI default)
cu     research    ⚠ not supported
```

### Doctor Model Check

Extend existing `aigon doctor` command with model validation:
- Verify model ID format matches expected provider pattern
- Check `--model` flag availability per agent CLI (e.g. `claude --help | grep model`)
- Warn on Cursor (no programmatic model control)

## Out of Scope

- Cost estimation or token budget tracking
- Automatic model selection based on task complexity

## Dependencies

- Feature 19: Model Selection Core (the config schema this tooling surfaces)
- Feature 20: Cross-Provider Eval (the eval model behaviour this tooling exposes)

## Related

- Feature 19: Model Selection Core
- Feature 20: Cross-Provider Eval
