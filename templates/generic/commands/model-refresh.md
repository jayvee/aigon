<!-- description: Probe providers for new models, benchmark them, and research any failures -->
# aigon-model-refresh

You are running a full model registry refresh. This is an **agent-driven** workflow —
do not just call the CLI and stop. You must assess results, research failures, and update
the registry with evidence-backed conclusions.

The single source of truth for what models qualify lives in
**`docs/model-inclusion-policy.md`**. Re-read §1 (modality / domain hard exclusions)
and §6 (approval flow) before you accept any candidate. There is no "approve all" flag
— a human types y/n on every candidate or the model does not enter the registry.

## Step 1: Discover new models

```bash
aigon model-refresh                       # discover + interactive approval
aigon model-refresh --approve-pending     # drain .aigon/pending-models.json
```

The first command opens the interactive approval flow. For each candidate:
- ✅ suitable (tool-capable, not thinking-mode, not too small/expensive) → include unless you have a specific reason not to
- ⚠️ risky → review the stated reason; include only if you have evidence the risk doesn't apply

The second drains any candidates that earlier non-interactive discovery runs
(`aigon perf-bench`, scheduled jobs) wrote into the pending queue. Always run
`--approve-pending` *before* running discovery — otherwise you may re-discover the
same candidates.

After approval, any added models are written to `templates/agents/op.json` and/or `templates/agents/gg.json`.

## Step 2: Check existing models for stale/invalid entries

```bash
cat templates/agents/op.json | node -e "
const d=JSON.parse(require('fs').readFileSync('/dev/stdin','utf8'));
const opts=d.cli.modelOptions;
const active=opts.filter(o=>!o.quarantined&&!o.archived);
console.log('Active models:', active.length);
active.forEach(o=>console.log(' ', o.value, '| score:', o.score?.implement, '| refreshed:', o.lastRefreshAt?.slice(0,10)));
"
```

Flag models that:
- Have `lastRefreshAt` older than 60 days
- Have `score.implement: null` (never benchmarked)
- Have notes mentioning timeouts, errors, or uncertainty

## Step 3: Benchmark newly added models

If any models were added in Step 1, or if known-stale models need re-evaluation:

```bash
aigon perf-bench brewboard --all --agents op
```

Watch the output. Note any failures — their error messages tell you whether it's:
- **Infrastructure**: "Timed out", "seed repo not found", "clone failed", "feature-start failed" → likely NOT the model's fault
- **Model**: probe failed, empty responses, tool-call refusal → likely the model

> **Timing note**: If you see seed clone failures immediately before a timeout, the timeout is
> almost certainly infrastructure, not the model. A clone failure eats into the 10m budget
> before the model is even invoked.

## Step 4: Research every timeout and error

For each model that timed out or errored — **before touching the registry** — research its current status:

### Research checklist per model:

1. **Is it still listed?**
   ```
   WebFetch: https://openrouter.ai/api/v1/models  (filter for the model ID)
   ```
   Or search: `"{model-id}" site:openrouter.ai`

2. **Is there a deprecation notice?**
   Search: `"{model-name}" deprecated OR "end of life" OR "retirement" {current-year}`

3. **Are there known routing/latency issues?**
   Search: `"{model-name}" timeout OR slow OR "tool use" OR "tool call" {current-year}`
   Check: openrouter.ai/models/{provider}/{model}/providers for provider spread

4. **What's the provider's current recommendation?**
   Check the provider's changelog/announcements for newer versions that supersede it.

5. **Platform status at time of failure?**
   Check: https://status.openrouter.ai for any incidents near the benchmark timestamp.

### Classify each finding:

| Classification | Criteria | Action |
|---|---|---|
| **TRANSIENT INFRA** | Clone failure before run; OR platform incident at time; OR model active + no issues found | Update note with evidence; schedule re-test |
| **MODEL DEGRADED** | Active but community reports of slowness/errors; latency 2-3× worse than previous | Update note with evidence; lower score |
| **DEPRECATED** | No longer listed OR provider issued EOL OR replaced by newer version | Quarantine with source URL and date |
| **ROUTING BROKEN** | Listed but no healthy providers; tool-use endpoints gone | Quarantine with "no tool-use endpoints" |

## Step 5: Update the registry

For **TRANSIENT INFRA** — update the note with your research findings, do NOT quarantine:
```json
"notes": {
  "implement": "...existing note... Timeout on 2026-XX-XX traced to seed clone failure before run — not model degradation. <source>. Re-test on clean infrastructure before quarantine."
}
```

For **DEPRECATED** or **ROUTING BROKEN** — quarantine it:
```bash
aigon agent-quarantine op <model-value> "<reason with source URL>"
```

Or add manually to `templates/agents/op.json`:
```json
"quarantined": {
  "since": "YYYY-MM-DD",
  "reason": "...",
  "evidence": "<URL or benchmark file>",
  "supersededBy": ["<replacement-model-id>"]
}
```

For **MODEL DEGRADED** — update the note and adjust the score:
```json
"notes": { "implement": "...existing note... ⚠️ Degraded as of YYYY-MM: <evidence URL>." },
"score": { "implement": <lowered-value> }
```

## Step 6: Restart the server

```bash
aigon server restart
```

Required after any `templates/agents/*.json` edit.

## Step 7: Commit

```bash
git add templates/agents/op.json templates/agents/gg.json
git commit -m "chore(model-refresh): $(date +%Y-%m) registry update"
```

Include a brief commit body noting:
- How many models were added
- Which models were quarantined (if any) and why
- Which timeouts were cleared as infra (not model failures)

## Notes

- Never quarantine based on a single timeout if a clone/seed failure preceded it — that's infrastructure noise
- Never quarantine based on a timeout alone without web research confirming the model is actually degraded
- The probe (`aigon agent-probe op --all`) is a fast sanity check before benchmarking — run it if you suspect routing issues
- DeepSeek V3.2 is inherently slow (35 tok/s median); its 10m bench window is marginal — a clean-run timeout alone is not sufficient to quarantine it

ARGUMENTS: {{ARG_SYNTAX}}
