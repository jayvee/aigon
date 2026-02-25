# Feature 19: Model Selection Core

## Summary

Add per-task-type model selection to Aigon. Today every agent uses whatever model the user has globally configured — the same model for research, implementation, and evaluation. This feature introduces a `cli.models` config field that lets Aigon inject the right `--model` flag when launching an agent, based on task type.

Three task types: `research` (research-conduct), `implement` (feature-implement, feature-review), `evaluate` (feature-eval, research-synthesize).

## User Stories

- [ ] As a developer, I want Aigon to automatically use Opus for research and Sonnet for implementation so I get quality where it matters and speed where it doesn't
- [ ] As a developer, I want to override model defaults at the project level so different projects can use different models without changing global config
- [ ] As a developer, I want the model injection to be transparent — I can see which model was used in the launch command
- [ ] As a developer using arena mode, I want each agent to use its own task-appropriate model independently

## Acceptance Criteria

- [ ] `cli.models.{research,implement,evaluate}` field added to agent config schema
- [ ] `buildAgentCommand()` accepts a `taskType` parameter and injects `--model <value>` when configured
- [ ] `buildResearchAgentCommand()` injects `--model <value>` using `research` task type
- [ ] Config precedence: project `.aigon/config.json` > global `~/.aigon/config.json` > agent template default
- [ ] Each `models` key is independently overridable (can set just `research` without affecting `implement`)
- [ ] When no model is configured for a task type, behaviour is unchanged (no flag injected)
- [ ] Sensible defaults added to all agent templates (`cc`, `gg`, `cx`, `cu`)
- [ ] Cursor (`cu`) emits a warning if a model is configured (no `--model` flag support — UI only)

## Technical Approach

### Config Schema

Add to `templates/agents/cc.json` (and equivalent for gg, cx, cu):

```json
{
  "cli": {
    "command": "claude",
    "implementFlag": "--permission-mode acceptEdits",
    "models": {
      "research": "opus",
      "implement": "sonnet",
      "evaluate": "sonnet"
    }
  }
}
```

User override in `~/.aigon/config.json` or `.aigon/config.json`:

```json
{
  "agents": {
    "cc": {
      "models": {
        "research": "claude-opus-4-6",
        "implement": "claude-sonnet-4-6"
      }
    }
  }
}
```

### Command Builder Changes

`buildAgentCommand(wt, taskType)` — add `taskType` param (default: `'implement'`):

```javascript
const modelConfig = getAgentCliConfig(wt.agent);
const model = modelConfig?.models?.[taskType];
const modelFlag = model ? `--model ${model}` : '';
// inject into command string after implementFlag
```

`buildResearchAgentCommand(agentId, researchId)` — always uses `taskType = 'research'`.

### Agent Template Defaults

| Agent | research | implement | evaluate |
|-------|----------|-----------|----------|
| cc | opus | sonnet | sonnet |
| gg | gemini-2.5-pro | gemini-2.5-pro | gemini-2.5-flash |
| cx | (default) | (default) | (default) |
| cu | (warn — no flag support) | (warn) | (warn) |

### Precedence

Follows exact same merge strategy as existing `getAgentCliConfig()` — project > global > template. Each key in `models` is merged independently.

## Out of Scope

- Automatic/adaptive model selection based on task complexity
- Cost tracking or billing integration
- Env var override (covered in Feature 21)
- Eval bias enforcement (covered in Feature 20)

## Dependencies

- Feature 08: Agent CLI flag overrides (established the `implementFlag` pattern this follows)

## Related

- Feature 20: Cross-Provider Eval (uses the `evaluate` task type introduced here)
- Feature 21: Model Management Tooling (exposes this config via CLI)
