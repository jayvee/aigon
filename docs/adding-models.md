# Adding Models to Agent Configs

This guide is for **maintainers** updating the curated model registry in `templates/agents/<id>.json`. End users do not add models through the CLI — the registry is the single source of truth for the dashboard start-modal Model dropdown and complexity-based recommendations.

## When a model is eligible

Read **`docs/model-inclusion-policy.md`** first. A model belongs in `cli.modelOptions` only if it:

- Drives an **agentic coding loop** (text-in, text-out, tool use, multi-turn shell/file edits).
- Uses a **pinned model ID** the provider CLI accepts (no `-latest` aliases).
- Has known **pricing** for paid SKUs, or is plan-bundled (cc/gg).
- Passes maintainer review — OSS does not auto-discover or auto-approve models.

Hard exclusions (vision-only, TTS, reasoning-mode variants without exception, etc.) are listed in the policy. When in doubt, do not add the model live; add a `quarantined` entry instead.

## Required fields per `modelOptions` entry

Every entry in `cli.modelOptions` needs:

| Field | Purpose |
|-------|---------|
| `value` | Literal model ID passed to the agent CLI (e.g. `claude-fable-5`). Use `null` only for the "Default" row. |
| `label` | Human-readable name shown in the picker. |
| `pricing` | `{ input, output }` in USD per million tokens. Omit only for plan-bundled SKUs. |
| `score` | `{ spec_review, implement, review, spec, research }` — each `number` or `null`. New models start with all `null` until a scored eval sweep. |
| `notes` | One sentence per role explaining fit. Required before promoting into `complexityDefaults`. |
| `lastRefreshAt` | ISO timestamp when the entry was added or last confirmed on the provider. |

Optional:

- `quarantined: { since, reason, evidence, supersededBy }` — mark broken models without deleting them (audit trail).

The first row is always `{ "value": null, "label": "Default" }`.

## Which file to edit

Edit the agent JSON that owns the CLI route:

| Agent ID | File | CLI |
|----------|------|-----|
| `cc` | `templates/agents/cc.json` | Claude Code |
| `gg` | `templates/agents/gg.json` | Gemini CLI |
| `cx` | `templates/agents/cx.json` | Codex CLI |
| `cu` | `templates/agents/cu.json` | Cursor |
| `op` | `templates/agents/op.json` | OpenCode |
| others | `templates/agents/<id>.json` | per registry |

Add the entry to `cli.modelOptions`. Place new top-tier models after existing entries of the same family, generally ordered cheap → capable within the array (see existing cc.json for the pattern). If the model has a 1M context variant in Claude Code, add a companion `[1m]` row following the Sonnet/Opus pattern.

**Do not** hand-edit `cli.modelOptions` casually — see `docs/model-inclusion-policy.md` §6 for the approval flow. This doc describes the mechanical steps once a model is approved.

## After editing JSON

1. Validate JSON parses:

   ```bash
   node -e "JSON.parse(require('fs').readFileSync('templates/agents/cc.json','utf8'))"
   ```

2. Restart the dashboard server (required after any `lib/*.js` or agent JSON change consumed at runtime):

   ```bash
   aigon server restart
   ```

3. Confirm the model appears in the start-modal Model dropdown when that agent is selected (dashboard → Start on a backlog feature).

4. Probe the model if the CLI supports `--model`:

   ```bash
   aigon agent-probe cc --model <model-id>
   ```

## Promoting into `cli.complexityDefaults`

`cli.complexityDefaults` maps spec `complexity:` (low / medium / high / very-high) to `{ model, effort }` pre-selections in the start modal. **Do not** add a new model here until:

1. Maintainer qualification has filled in `score` for the relevant roles.
2. The model outperforms or justifies cost vs the incumbent for that complexity bucket.
3. `notes` for each role it will serve are written.

Promotion is a separate, scored-eval-driven change — not part of initial model addition.

## Quarantining a broken model

Never delete a model entry that users or benchmarks may have referenced. Instead add:

```json
"quarantined": {
  "since": "2026-06-10T00:00:00.000Z",
  "reason": "agent-probe timeout on implement workload",
  "evidence": "aigon agent-probe cc --model <id> failed 3×",
  "supersededBy": "claude-sonnet-4-6"
}
```

Quarantined models are hidden from pickers by default but remain in the registry for audit. Remove the `quarantined` block only after a clean re-probe.

## Related

- `docs/model-inclusion-policy.md` — eligibility, lifecycle, approval flow
- `docs/adding-agents.md` — onboarding a new agent CLI (different process)
- `templates/agents/<id>.json` — registry source of truth
