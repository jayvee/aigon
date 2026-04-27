# Implementation Log: Feature 414 - simplify-agent-id-registry-2026-04
Agent: cc

Replaced agent-id `if/else` ladders in `lib/session-sidecar.js`, `lib/telemetry.js`, and `lib/commands/setup.js` with data-driven dispatch via a new `runtime` block in `templates/agents/<id>.json` plus `getSessionStrategy / getTelemetryStrategy / getTrustInstallScope / getResumeConfig` helpers in `lib/agent-registry.js`.
