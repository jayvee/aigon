# Research: integrate-with-llm-observability-tools

## Context

Enterprise companies use LLM observability platforms (HoneyHive, Langfuse, Helicone, Braintrust, etc.) to monitor, control, and optimize AI usage across their organizations — tracking costs, latency, quality, and policy compliance. Aigon orchestrates multiple AI agents running LLM calls across features, but currently has limited visibility into the underlying model usage. Integrating with these observability tools could: (1) give enterprises the compliance visibility they require, (2) enrich Aigon Pro's feature-level insights with per-agent cost/quality/latency data, and (3) provide a natural Pro gating point. This research should map the integration opportunities and how observability data flows back into Aigon's insights engine.

## Questions to Answer

### Landscape
- [ ] What are the major LLM observability tools? (HoneyHive, Langfuse, Helicone, Braintrust, Arize, others)
- [ ] What do they track? (token usage, cost, latency, quality scores, traces, spans, guardrails)
- [ ] How do they integrate? (SDK instrumentation, proxy/gateway, OpenTelemetry, API keys)
- [ ] Which are open-source vs commercial? Which have self-hosted options?

### Integration points with Aigon
- [ ] Where do LLM calls happen in Aigon's agent lifecycle? (agent CLI → model API — Aigon doesn't make the calls directly, the agent CLIs do)
- [ ] Can Aigon instrument at the orchestration level without modifying agent CLIs? (e.g., environment variable injection, proxy configuration)
- [ ] Could Aigon act as a pass-through proxy that routes agent LLM traffic through an observability layer?
- [ ] What telemetry does Aigon already collect? (`lib/telemetry.js`) How does it compare?

### Enriching Aigon Pro insights
- [ ] How could per-agent LLM cost data feed into feature-level cost analysis? (e.g., "feature 07 cost $4.20 across 3 agents")
- [ ] Could quality scores from observability tools inform the evaluation/winner selection?
- [ ] What correlations could Aigon surface? (e.g., "cc uses 3x more tokens than cx but produces higher-quality code")
- [ ] How would this data integrate with the existing Aigon Pro insights engine (`@aigon/pro`)?

### Enterprise value
- [ ] What do enterprise compliance teams need to see? (cost caps, usage policies, data residency)
- [ ] Is observability integration a Pro feature, an Enterprise feature, or both?
- [ ] Could Aigon offer a "bring your own observability" model where enterprises plug in their existing tool?

## Scope

### In Scope
- Survey of LLM observability tools and their integration patterns
- Aigon's telemetry architecture and extension points
- Feature-level insight enrichment from observability data
- Enterprise compliance and governance use cases
- Integration architecture (proxy, SDK, env vars, adapter pattern)

### Out of Scope
- Building the integration — this is research only
- Aigon's internal telemetry rewrite (separate concern)
- Non-LLM observability (APM, infrastructure monitoring)
- Pricing of observability tools

## Inspiration
- HoneyHive: https://www.honeyhive.ai/
- Langfuse (open-source): https://langfuse.com/
- Helicone (proxy-based): https://helicone.ai/
- Aigon telemetry: `lib/telemetry.js`
- Aigon Pro insights: `@aigon/pro` package

## Findings
<!-- Document discoveries, options evaluated, pros/cons -->

## Recommendation
<!-- Summary of recommended approach based on findings -->

## Output
<!-- Based on your recommendation, create the necessary feature specs by running the `aigon feature-create "<name>"` command. Link the newly created files below. -->
- [ ] Feature:
