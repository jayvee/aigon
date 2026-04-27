---
complexity: medium
set: competitive-positioning
---

# Feature: local-model-first-class-support

## Summary
Make local Ollama and OpenAI-compatible HTTP endpoints first-class in agent configuration so users can run the harness against local models without monkey-patching agent JSON or shelling out manually. Closes a gap surfaced repeatedly in research-25 (OpenCode) and reaffirmed in research-44 — OpenCode (75+ providers) and Goose (70+ extensions) make BYO-local-model table-stakes; Aigon currently assumes hosted CLI agents.

## User Stories
- [ ] As a cost-conscious solo developer, I run a Fleet with one hosted agent and two local Ollama models, configured via `aigon config models` or a single agent JSON entry — not by editing internal code.
- [ ] As a privacy-sensitive user, I can run the entire Aigon workflow against local models and verify no traffic leaves my machine.
- [ ] As an experimenter, I can swap an agent's backing endpoint to a local OpenAI-compatible server (vLLM, llama.cpp server, LocalAI) without rebuilding anything.

## Acceptance Criteria
- [ ] `templates/agents/<id>.json` schema supports a `provider: "ollama" | "openai-compatible"` block with `endpoint`, `model`, `apiKey?`, `headers?` fields. JSON Schema or runtime validation rejects malformed entries with a clear message.
- [ ] At least one local-model agent ships out of the box (e.g., `templates/agents/lo.json` pointing at default Ollama, OR an existing slot configurable via env).
- [ ] `aigon config models` lets the user attach a local-endpoint config to an existing agent slot without hand-editing JSON.
- [ ] The launch path (`lib/agent-launch.js` `buildAgentLaunchInvocation`) honours the local-endpoint config for spawn, per-feature `{model, effort}` overrides, and failover. A regression test pins the invocation shape so future spawn-path changes don't silently drop local-endpoint flags.
- [ ] `lib/agent-failover.js` handles local-endpoint failure modes (connection refused, model not loaded, timeout) without false-positive token-exhaustion classification.
- [ ] Documentation lands at `docs/local-models.md` (or extension to `docs/agents/`) with a worked Ollama setup walkthrough and one OpenAI-compatible example.

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
- Extend `lib/agent-registry.js` to recognize the new provider field; surface it in capability lookups so feature-start / install-agent paths know whether the agent needs a CLI binary on PATH.
- `buildAgentLaunchInvocation` already routes through one helper — add a branch for local-endpoint providers without breaking the existing hosted-CLI path. Honour the precedence rule from AGENTS.md (event override > workflow stage triplet > `aigon config models` > agent JSON default > null).
- Per `docs/agents/op.md`, model/provider selection for OpenCode stays in the user's OpenCode config — same deference applies here. Aigon does not bake provider catalogs; it surfaces what the user configures.
- Keep agent-status / shell-trap signals working unchanged — local agents still need to fire `submitted` / `error` on exit so the engine can react.

## Dependencies
- depends_on: none

## Out of Scope
- Building a local-model UI inside the dashboard for endpoint testing (separate feature if desired).
- Pre-shipping a curated list of recommended local models — defer to docs.
- Routing logic that picks between local and hosted based on cost/load (separate feature).
- Local model performance benchmarking inside Aigon — refer users to community leaderboards.

## Related
- Research: R44 — competitive positioning and landscape
- Research: R25 — OpenCode comparison (origin of the gap)
- Set: competitive-positioning
