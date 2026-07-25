---
aigon_id: F714
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-04T23:44:30.649Z", actor: "cli/feature-prioritise" }
---

> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.


# Feature: agent-failover-pro-tier

## Summary

Move the agent failover capability — automatic and manual — out of the OSS aigon repo and into aigon-pro as a first-class Pro feature. Today, OSS already ships the detection signal (stderr-pattern + telemetry-limit), the supervisor sweep that records `agent.token_exhausted` / `agent.failover_switched` engine events, the `chooseNextAgent` chain walker, and the dashboard `switch-agent` HTTP endpoint — but none of it is surfaced in the dashboard UI, no manual control exists, and the capability is undocumented. This feature does three things: (1) lifts the active behaviour to Pro so it becomes part of the commercial tier; (2) ships the missing UI — a "Failover now" menu item on the agent slot card and inline activity-feed entries for both events; (3) writes the public guide that explains the configuration model, the auto and manual flows, and how to verify a failover happened.

## User Stories

- [ ] As an operator running an autonomous feature on a primary agent, when that agent hits its quota I want Aigon to automatically continue the work on the next agent in my failover chain so I don't have to babysit long-running runs.
- [ ] As a Pro user, I want a "Failover now →" menu item on a stalled agent slot so I can trigger a manual hand-off without editing config files or restarting the feature.
- [ ] As a Pro user, I want exhaustion events and failover hand-offs to appear in the feature's activity feed so the audit trail is visible without tailing `events.jsonl`.
- [ ] As an OSS user, I want clear messaging that failover is a Pro capability — not a silently-broken OSS feature — so I can decide whether to upgrade.
- [ ] As any user reading the docs, I want one guide that covers chain configuration, policy modes, the auto path, the manual button, and how to verify it ran.

## Acceptance Criteria

### Code move (OSS → Pro)
- [ ] `lib/agent-failover.js` is removed from the OSS repo and re-homed in `aigon-pro/lib/agent-failover.js`.
- [ ] The supervisor sweep's failover branch (`lib/supervisor.js:sweepEntity` ~lines 537-582 and `switchFeatureAgent` ~lines 461-510) is extracted to a Pro-side hook. The OSS supervisor exposes a registration point (e.g. `supervisor.registerExhaustionHandler(fn)`) that aigon-pro wires into at load time. If aigon-pro is not installed, the OSS supervisor records nothing and takes no action.
- [ ] The OSS `lib/dashboard-routes/entities.js` `switch-agent` action is removed; the equivalent handler lives in aigon-pro and is registered into the dashboard route table via the existing Pro-extension pattern.
- [ ] `getAgentFailoverConfig` in `lib/config.js` stays in OSS (read-only schema is shared) but the `policy: "switch"` path becomes a no-op without aigon-pro loaded. When OSS reads `policy: "switch"` and Pro is absent, log a one-line warning at supervisor startup: `agentFailover.policy=switch requires aigon-pro; falling back to notify`.
- [ ] Engine event types `agent.token_exhausted` and `agent.failover_switched` (and their projector branches) **stay in OSS** — they are part of the workflow event vocabulary and Pro just emits them. Removing them would corrupt event logs in older repos.
- [ ] Events are emitted from Pro code, projected by OSS code, surfaced by Pro UI.

### Dashboard — "Failover now →" menu item
- [ ] A "Failover now → `<next-agent>`" entry appears on the agent slot card menu when **all** of: `entityType === 'feature'`, `snapshot.agents[<slot>].tokenExhausted` is set, and `chooseNextAgent(chain, currentAgentId, [currentAgentId])` returns a candidate.
- [ ] When `chooseNextAgent` returns null (chain exhausted), the menu item appears as **disabled** with tooltip "No agents left in failover chain".
- [ ] When `tokenExhausted` is not set, the item is hidden entirely (do not show as disabled — keeps the menu uncluttered for healthy slots).
- [ ] Click invokes `POST /api/feature/:id/agent/:agent` with `action: "switch-agent"`. The existing endpoint contract is preserved.
- [ ] Success: dashboard re-fetches snapshot, the slot label updates from `cc` to `cx (was cc)` or similar, and a green toast confirms `Switched cc → cx`.
- [ ] Failure (e.g. 409 chain exhausted): red toast with the server's error message.
- [ ] The menu item label uses the **next agent's id** dynamically (`Failover now → cx`), not a static label. Falls back to `Failover now` if the chain lookup fails client-side.

### Dashboard — activity feed entries
- [ ] The feature detail panel's activity feed includes one row per `agent.token_exhausted` event: `🟡 cc hit token limit · usage limit · 14:02` (clock-time in user's tz, source string from event payload).
- [ ] One row per `agent.failover_switched` event: `🟢 Failover · cc → cx · last commit a1b2c3d · 14:02`.
- [ ] Rows are styled distinctly from progress events (yellow = warn, green = recovery).
- [ ] Rows are filterable / show in the existing event-stream widget — no new component if a feed already renders other event types.
- [ ] Snapshot test added (Playwright) capturing a feature with both events present.

### Public documentation
- [ ] New page `site/content/guides/agent-failover.mdx` (linked from the guides index and from `agent-quota-awareness.mdx` "See also").
- [ ] Page sections: *Why this exists* · *How it works* · *Configuration* · *Auto-failover* · *Manual failover* · *Verifying it ran* · *Limitations* · *Pro tier note*.
- [ ] *Configuration* shows the JSON schema with `policy` (notify | switch | pause), `chain` (ordered priority list), `tokenLimits.perSessionBillableTokens`, and per-agent stage-default model expectations.
- [ ] *Auto-failover* explains: detection inputs (stderr patterns + exit codes, or telemetry over-limit), the 30-second supervisor cadence, that the chain walks **forward only** from the current agent, and that an exhausted agent is not retried later in the same run.
- [ ] *Manual failover* explains the menu item, when it appears, and the gate (`tokenExhausted` must be recorded server-side first).
- [ ] *Verifying it ran* lists: the activity feed entries, the `events.jsonl` path, and a one-liner to grep for the two event types.
- [ ] *Pro tier note* clearly states that auto-failover and the menu item require aigon-pro; the engine event vocabulary works in OSS but `policy: switch` will silently degrade to `notify` without Pro.
- [ ] `compare.mdx` is updated to mention failover under the OSS-vs-Pro split.
- [ ] `getting-started.mdx` Pro section gets one bullet calling out failover.

### Integration test (Pro)
- [ ] `aigon-pro/tests/integration/agent-failover-end-to-end.test.js` exercises the full path with the OSS test-mode harness (`AIGON_TEST_MODE=1`, MockAgent):
  1. Start a feature on `cc` with chain `[cc, cx, gg]` and `policy: switch`.
  2. Forge an agent-status record with `lastExitCode: 1`, `lastPaneTail: 'usage limit'`.
  3. Drive the supervisor sweep once.
  4. Assert: `agent.token_exhausted` appended, `agent.failover_switched` appended, snapshot now reads `currentAgentId: cx` with `previousAgentId: cc`, the cc tmux session was killed, a new session for the cx replacement was created.
  5. Forge a second exhaustion on cx; assert the third sweep records exhaustion + switch to gg.
  6. Forge a third exhaustion on gg (chain end); assert exhaustion is recorded but no switch event is appended.
- [ ] Test runs in under 5 seconds; no real agent binaries are spawned.

### OSS-side test (current behaviour, pre-move regression catcher)
- [ ] Tracked in a separate small OSS feature: `feature-failover-integration-test` (see *Dependencies* below). Not part of this spec's deliverables, but **this spec depends on it landing first** — it gives us a green baseline to migrate.

## Validation

```bash
# Pro repo unit + integration tests
cd ~/src/aigon-pro && npm test
# OSS repo regression — failover events must still project correctly without Pro loaded
cd ~/src/aigon && npm test
# Dashboard — Pro must register both the menu item and the feed rows
cd ~/src/aigon && MOCK_DELAY=fast npm run test:ui
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May edit `site/content/guides/_meta.tsx` to register the new failover guide.
- May add `Failover now` strings without a separate i18n review — the dashboard is single-locale today.

## Technical Approach

### Pro-extension registration pattern
The cleanest split keeps OSS as the substrate and Pro as a pluggable layer. There are two integration points:

1. **Supervisor exhaustion handler.** OSS supervisor exposes:
   ```js
   // lib/supervisor.js
   const exhaustionHandlers = [];
   function registerExhaustionHandler(fn) { exhaustionHandlers.push(fn); }
   // … inside sweepEntity, after detection:
   for (const fn of exhaustionHandlers) await fn({ repoPath, entityId, agentId, signal, snapshot });
   ```
   aigon-pro registers a handler at module load that does the chain selection, prompt build, tmux kill+respawn, and `recordAgentFailoverSwitch` call. If no handler is registered, OSS still records `agent.token_exhausted` (vocabulary is shared) and emits the macOS notification, but does not switch.

2. **Dashboard route extension.** Pro registers the `switch-agent` action handler via the existing dashboard-routes plugin entry (mirror how Pro already injects insights/AADE routes — confirm the exact mechanism during implementation).

### Why events stay in OSS
The projector lives in `lib/workflow-core/projector.js`. Moving event types out would mean an OSS user opening a Pro-touched repo would see "unknown event type" warnings and the snapshot would be wrong. The vocabulary is shared schema. Behaviour around the events is what's gated.

### Menu item placement
Today the agent slot card has a kebab/right-click menu (verify exact component during implementation; see `templates/dashboard/js/pipeline.js` and the agent-tile component). The new item slots in beneath any existing "Re-open agent" / "View logs" entries. Use `Skill(frontend-design)` before any visual change per CLAUDE.md hot rule #7.

### Activity feed rows
If no per-feature activity feed component currently exists in the dashboard (grep returned no hits for `agent.token_exhausted` or `agent.failover_switched` in `templates/dashboard/`), this feature includes building a minimal one that reads `.aigon/state/feature/<id>/events.jsonl` via the existing feature-detail API and renders the latest N events. If a feed exists, just teach it about the two new types.

### Terminology
User-facing label is **"Failover"** (industry-standard, signals production-grade resiliency — used by Vercel AI SDK, LiteLLM, Portkey, and HA databases). Internal config keys (`agentFailover`, `agentFailover.chain`, `agentFailover.policy`) and event names (`agent.token_exhausted`, `agent.failover_switched`) stay as they are — already shipped, no churn justified.

### Public-docs voice
Match the existing `agent-quota-awareness.mdx` tone — calm, declarative, explains *why this matters* before *how to use it*. Avoid hype in the docs body; the marketing lift goes in `compare.mdx` and the Pro section of `getting-started.mdx`.

## Dependencies

- depends_on: feature-failover-integration-test  <!-- tracked separately in OSS so we have a regression baseline before the move -->

## Out of Scope

- Per-agent quota cooldown awareness (e.g. "retry CC after the 5-hour Anthropic window resets"). Worth doing later but explicitly not in this feature — the chain stays forward-only.
- Chain wrap-around or "preferred" strategy. Forward-only is the agreed semantics; both alternatives were considered and deferred.
- Pre-emptive switching before exhaustion (e.g. "switch when 90% of quota consumed"). The manual button only appears post-exhaustion; matches the existing server-side gate.
- Failover for `research` entities. Today the supervisor only runs the failover branch for features (`entityType === 'feature'`); preserve that scope.
- Per-agent override for the failover chain (e.g. different chain for cc vs cx as the starting agent). One global chain is enough until proven otherwise.
- Fixing the model-override-on-failover edge case where a slot's `modelOverride` (e.g. `opus`) gets passed to a different agent's CLI on switch. Track separately if it triggers in practice.

## Open Questions

- What is the existing Pro-extension registration mechanism in the dashboard route table? (The implementer should mirror the pattern aigon-pro already uses for insights/AADE rather than invent a new one.)
- Should the OSS warning ("policy=switch requires aigon-pro") fire once per supervisor start or once per repo per start? Once per start is probably right.
- Where does the failover guide sit in the docs IA — under "Guides" alphabetically, or under a new "Resilience" sub-section? Default to alphabetical until we have more resilience content.

## Related

- Research: —
- Set: —
- Prior features in set: F308 (auto-failover-agent-on-token-exhaustion, OSS, done) — original landing of detection + switch in OSS. This feature is the Pro lift + UI completion of that work.
