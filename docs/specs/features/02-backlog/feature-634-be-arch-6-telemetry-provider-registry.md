---
complexity: medium
set: be-arch
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-07T06:05:29.103Z", actor: "cli/feature-prioritise" }
---

# Feature: be-arch-6-telemetry-provider-registry

## Summary

Split `lib/telemetry.js` (1,935 lines) into a telemetry package with per-provider parser modules. Today one file contains five complete transcript-format implementations inline — Claude JSONL (`parseTranscriptSession`, `resolveClaudeProjectDir`), Gemini chats (`resolveGeminiChatsDir`, `parseGeminiSessionFile` — historic, gg is deactivated), Antigravity sqlite (`_antigravityQuery`, `parseAntigravityConversationDb`), Codex sessions (`parseCodexSessionFile`, `findCodexSessionFiles`), and OpenCode sqlite (`_opencodeQuery`, `parseOpenCodeDb`) — plus the shared normalization/pricing/aggregation core. The codebase already has the right pattern twice over: `lib/agent-registry.js` exposes `getTelemetryStrategy` (F414: "all consumers read these instead of branching on agent id") and `lib/terminal-adapters.js` is a registry where "adding a new terminal requires only one adapter object" (F350). Telemetry is the volatile surface that pattern exists for — the Gemini→Antigravity migration is happening right now, and each new agent (op was added recently) means edits inside a 2k-line shared file. After this feature: adding an agent's telemetry = adding one provider module.

## User Stories

- [ ] As a maintainer adding Antigravity-successor telemetry (or any new agent), I write `lib/telemetry/providers/<id>.js` implementing the provider contract and register it — no edits to shared parsing code.
- [ ] As a maintainer removing gg (per the planned Gemini removal), I delete one provider file; historic-display fallbacks degrade gracefully.
- [ ] As an implementing agent, pricing/normalization/aggregation logic is a core module I can test without any provider's filesystem fixtures.

## Acceptance Criteria

- [ ] `lib/telemetry/` package: `index.js` (public facade, same exported surface as today's `lib/telemetry.js` — keep `lib/telemetry.js` as a one-line re-export or move importers, whichever is smaller; fan-in is modest), `core.js` (normalized-record read/write, `getEffectiveNormalizedTelemetryRecords`, aggregation, `computeContextLoadTokens`), `pricing.js` (`_buildPricingFromRegistry`, `getModelPricing`, `computeCost`), and `providers/{cc,gg,ag,cx,op}.js`.
- [ ] Provider contract (documented in the package): each provider exports a small fixed surface — locate transcripts for a worktree/feature (e.g. `findSessions({ worktreePath, featureId, options })`) and parse them to the normalized record shape (`parseSessions(...)`). The normalized record schema is owned by `core.js` and is the only coupling between providers and core.
- [ ] Dispatch goes through the agent registry: `getTelemetryStrategy(agentId)` (already in `lib/agent-registry.js`, F414) maps to the provider module — audit current strategy values and align; no `if (agentId === 'cx')` branching survives in core (grep-verified).
- [ ] sqlite access (`_antigravityQuery`, `_opencodeQuery`, `_sqlEscape`) — shared between two providers — becomes one helper module inside the package; identical query/escape semantics.
- [ ] Behaviour parity: `aigon capture-session-telemetry`, `capture-antigravity-telemetry`, `aigon stats`, analytics cost columns, and the dashboard stats tab produce identical output on a repo with existing telemetry from at least cc + cx (record the comparison in the log). Fallback-record handling (`isFallbackTelemetryRecord`) unchanged.
- [ ] Existing telemetry tests pass (import paths only); parsing tests move next to their provider. Per T2, the provider-contract seam gets one test proving an unknown agent id degrades to "no telemetry" (not a throw).
- [ ] No new cycles (be-arch-1 guard); providers import core, never each other, never agent-registry (the registry maps *to* providers — encode direction in the guard rules).
- [ ] AGENTS.md module map: telemetry row updated to the package shape.

## Validation

```bash
node scripts/check-module-graph.js
npm run test:iterate
```

## Technical Approach

- This is dominantly a mechanical move — the provider seams are already visually obvious in the file (contiguous line ranges per provider). The design work is the provider contract; keep it as narrow as the current call sites actually need (look at `aggregateNormalizedTelemetryRecords` and the two capture commands for the real surface — don't invent a richer interface than consumers use).
- gg is deactivated ("retained for historic telemetry display") — its provider module is the test that the contract handles read-only/legacy providers cleanly.
- Session-sidecar integration (`lib/session-sidecar.js` resolves transcript paths per agent at launch): check whether its per-agent resolution logic should consume the same provider modules (`findSessions`) — if trivial, unify; if not, note as follow-up in the log rather than expanding scope (memory: no sidecar reflex — audit before adding).
- Restart the dashboard server after `lib/*.js` edits (hot rule #3).

## Dependencies

- None hard (be-arch-1 guard helpful but not required). Independent of 2–5; safe to run in parallel with any of them.

## Out of Scope

- Changing the normalized telemetry record schema or where records are stored (`.aigon/telemetry/`).
- Adding/removing any provider (the gg removal is its own planned feature per the Gemini→Antigravity migration).
- Pricing data changes (pricing comes from the model registry; only the code moves).
- Live/streaming telemetry.

## Open Questions

- Exact current values of `getTelemetryStrategy` per agent JSON — align provider module ids to those strings, or extend agent JSON if a mapping is missing (never hardcode agent ids in `lib/`, per the registry's zero-hardcoded-agents rule).
- Whether `stats-aggregate.js` (rolled-up cache) has provider-specific assumptions — inspect; expected answer is no (it consumes normalized records).

## Related

- Prior work: F414 (`getTelemetryStrategy` and the registry-dispatch rule), F350 (terminal-adapter registry precedent), F357 (session sidecar transcript resolution), Gemini→Antigravity migration (project memory) as the live driver.
- Set: be-arch — the cleanest demonstration of the set's theme: the codebase already invented the right pattern; this applies it to the module that needs it most.
