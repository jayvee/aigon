# Feature: agent-idle-detector-and-spec-preauth

## Summary
Two related problems in one feature, both surfaced during the 2026-04-20/21 token-reduction work:

1. **Agents can sit idle for hours, unnoticed.** cc hit the test-budget ceiling mid-F291 overnight and stopped to ask for guidance — correctly, per CLAUDE.md rule T3. But the session was "alive-but-silent" and nothing flagged it. Wall-clock hours of autonomous work were lost before a human happened to glance at the dashboard. Same pattern seen with cx awaiter approval prompts (F282) earlier the same day.
2. **Many policy stops are decisions the user would pre-approve if asked.** "Raise the test budget by +25 LOC because the regression tests cover real invariants" is a routine yes — but the rules (correctly) make the agent stop. A feature spec has no way to say "I authorise X in advance."

This feature adds two complementary pieces:
- **Idle detector** in `lib/supervisor.js`: when a session is alive but no `agent-status` workflow signal has been emitted for > N minutes, classify it as idle-stuck and emit a dashboard badge + desktop notification.
- **Spec pre-authorisation block**: a `## Pre-authorised` section in the feature spec template where the user can list standing orders agents may enact without asking ("may raise test-budget ceiling by ≤ N", "may skip Step X if condition Y", etc.). The agent reads the section and treats anything listed as already-approved, with a commit-message note citing the pre-auth.

Together: stuck agents get noticed fast, and many stops that required a human decision are avoided altogether because the spec authorised them in advance.

## Desired Outcome
An overnight autonomous run where cc hits a small policy gate either (a) proceeds immediately because the spec authorised the deviation, or (b) gets a desktop notification within 20 minutes so the user can unblock it promptly. No more "woke up and the agent did nothing for 6 hours" mornings.

## User Stories
- [ ] As a user running autonomous features overnight, when cc hits a small policy gate (budget, security-scan warning, ambiguous acceptance criterion) that I'd routinely approve, the spec's `## Pre-authorised` block lets cc proceed without stopping.
- [ ] As a user who *didn't* pre-authorise something, when cc stops anyway, the dashboard shows an "awaiting input" badge on the card within 10 minutes and a desktop notification within 20 minutes — not hours later.
- [ ] As a reviewer auditing what an agent did autonomously, every action taken under a pre-auth block carries a commit footer citing which pre-auth line permitted it, so the audit trail is explicit.
- [ ] As the agent, I know clearly when to stop-and-ask (policy gate not in pre-auth) vs. when to proceed-and-cite (policy gate matches a pre-auth line). No new ambiguity introduced.
- [ ] As a supervisor dev, the idle detector is a pure observation — it never kills sessions, injects input, or auto-approves. Detection only. Every resolution still goes through the user.

## Acceptance Criteria

### Part A: Idle detector
- [ ] `lib/supervisor.js` gains an idle-detection pass that runs on its existing poll cadence (every ~30s).
- [ ] For each agent row the supervisor already considers (`snapshot.agents` with `status` in `running` or `idle`), **idle-stuck** is computed only when **all** of the following hold:
  - A tmux session for that agent is **alive** for the entity, using the **same naming rules as `buildTmuxSessionName` / `parseTmuxSessionName` in `lib/worktree.js`** — i.e. roles `do`, `eval`, `review`, `spec-review`, and `spec-check` (not only the legacy `{repo}-f{id}-{agent}` pattern). If multiple role sessions could exist for one agent, evaluate the one that is actually running or the union policy defined in implementation notes below.
  - `computeAgentLiveness` from `lib/workflow-heartbeat.js` still classifies the agent as **alive** (with today’s rules: **tmux alive ⇒ always `alive`**, so idle-stuck is specifically “session still there, agent not dead, but no progress events”).
  - No workflow **progress** event attributable to that `agentId` occurred in the last **N** minutes when scanning the tail of `.aigon/workflows/features/{id}/events.jsonl` or `.aigon/workflows/research/{id}/events.jsonl` (match `entityType`). **Progress events** are engine events with `type` in: `signal.agent_started`, `signal.agent_waiting`, `signal.agent_ready`, `signal.agent_submitted`, `signal.agent_failed` (the same family `agent-status` drives today via `lib/workflow-core/projector.js`). Optionally count `signal.heartbeat` only if the spec explicitly chooses it — default is **exclude** heartbeat so long test runs do not mask “no CLI progress.”
- [ ] Three default thresholds, configurable via `~/.aigon/config.json` (see **Configuration defaults**):
  - `soft` = 10 min → dashboard card shows an "awaiting input" badge (amber, distinct from the red "orphan" badge)
  - `notify` = 20 min → one-shot macOS/Linux desktop notification via `terminal-notifier` / `notify-send` ("F291 cc agent awaiting input — 20m idle")
  - `sticky` = 60 min → entry added to the dashboard notifications panel that persists until resolved
- [ ] Idle state is cleared the moment any **progress** event (as defined above) for that `agentId` is appended to the entity’s `events.jsonl`, or when the tmux session ends / agent drops out of `running`/`idle` in the snapshot (whichever matches supervisor’s existing lifecycle assumptions).
- [ ] Idle fields are exposed through the **existing dashboard read path** (`lib/dashboard-status-collector.js` merging supervisor-derived data into whatever structure backs session cards — extend that contract rather than inventing a parallel source). A dedicated `/api/sessions/idle` route is optional; same information may ride on the current sessions payload. **No** new action eligibility or buttons in dashboard JS — badges are display-only.
- [ ] Idle detection is OBSERVATION ONLY. No session kills, no input injection, no auto-approvals. The user resolves manually.
- [ ] Tests: supervisor test that a fresh session isn't idle; a session with no signal for > N minutes IS idle; a signal emitted mid-idle clears the flag.

### Part B: Spec pre-authorisation
- [ ] Feature spec template gets a new optional section `## Pre-authorised` (between `## Validation` and `## Technical Approach`, or another sensible slot). Blank/absent = no pre-auths, same as today.
- [ ] Each pre-auth is a single line with a clear condition + action, e.g.:
  - `- May raise \`scripts/check-test-budget.sh\` CEILING by up to +40 LOC if regression tests for this feature's invariants require it.`
  - `- May skip \`npm run test:ui\` when this feature touches only \`lib/\` and no dashboard assets.`
  - `- May self-grant a single \`--no-verify\` push IF the pre-push hook is blocking on a known-broken check unrelated to this feature; must commit a note explaining why.`
- [ ] The `feature-do` template is updated to: "Before stopping on a policy gate, check the spec's `## Pre-authorised` section. If the gate matches a pre-auth line, proceed and include a commit footer `Pre-authorised-by: <spec line>` citing which line authorised it. If no pre-auth matches, stop and ask as before."
- [ ] Every commit made under a pre-auth carries a footer: `Pre-authorised-by: <slug-of-preauth-line>` so `git log` is auditable.
- [ ] `lib/utils.js` (or a tiny new helper module re-exported from there if the file is already crowded) parses the `## Pre-authorised` section when building feature context and makes the lines available to the agent as part of the inlined spec / prompt material. **Not** `lib/validation.js` unless the iterate loop is the single consumer — default owner is spec I/O next to other spec readers. Simple string list, no DSL, no parsing beyond "markdown bullet per line" under that heading.
- [ ] Pre-auth lines are bounded and opt-in per feature — there's no global "auto-approve these" list. Each spec author decides what's acceptable for THAT feature.
- [ ] Tests: a spec with `## Pre-authorised` round-trips through spec-create / spec-review / feature-start and the agent sees the lines; a spec without the section behaves identically to today.

### Cross-cutting
- [ ] Under-test-budget net: this feature adds ≤ 40 LOC of tests. If at ceiling, piggyback on the existing pre-auth mechanism by citing it in the spec. (Feature eats its own dog food.)
- [ ] `docs/architecture.md` § Module Map updated for `lib/supervisor.js` — note the new idle-detection responsibility.
- [ ] `docs/development_workflow.md` updated to describe the pre-auth mechanism and point to examples.
- [ ] `AGENTS.md` **Rules Before Editing** (and the mirrored hot-rules pointer in `CLAUDE.md` if still present) get one new bullet: check the spec’s `## Pre-authorised` section before stopping on a policy gate; cite matching line in commit footer when proceeding.

## Validation
```bash
node -c lib/supervisor.js
node -c lib/validation.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests for idle detection or pre-auth parsing require it. Commit must cite this line in its footer.

## Technical Approach

### Idle detection mechanics
`lib/supervisor.js` already tracks agent liveness by reading `.aigon/state/heartbeat-<entity>-<id>-<agent>` mtimes and confirming tmux session existence. It already computes a liveness classification (alive / stale / dead).

The idle pass adds one more classification dimension: **progress**. For each alive session, read the entity's events log tail, find the last `agent-status`-derived event (signal.agent_ready, signal.agent_submitted, etc.) and compare its timestamp to now.

```js
function computeIdleState(repoPath, entityType, entityId, agentId, thresholds, sessionStartedAt) {
  const events = readRecentEvents(repoPath, entityType, entityId);
  const lastSignal = [...events].reverse().find((e) =>
    PROGRESS_TYPES.has(e.type) && e.agentId === agentId);
  const lastSignalAt = lastSignal
    ? new Date(lastSignal.at).getTime()
    : sessionStartedAt; // e.g. tmux session birth or last snapshot transition to running
  const idleMs = Date.now() - lastSignalAt;
  if (idleMs > thresholds.sticky * 60_000) return { level: 'sticky', idleMinutes: Math.floor(idleMs / 60_000) };
  if (idleMs > thresholds.notify * 60_000) return { level: 'notify', idleMinutes: Math.floor(idleMs / 60_000) };
  if (idleMs > thresholds.soft * 60_000) return { level: 'soft', idleMinutes: Math.floor(idleMs / 60_000) };
  return null;
}
```

The `notify`-level threshold fires a one-shot notification per transition — supervisor state tracks which sessions it has already notified for to avoid re-firing every 30s.

### Why workflow signals, not pane-content scanning
Parsing tmux pane content to detect "Approval needed in Ash [awaiter]" or "I'm hitting the test-budget ceiling" across cc/cx/gg/cu would mean four agent-specific content parsers, each fragile to UI updates. Workflow-signal absence is agent-agnostic: if the agent isn't emitting progress, it's stuck, regardless of *why*.

### Spec pre-auth parsing
Add a small `readSpecSection(specPath, '## Pre-authorised')` helper (or equivalent) next to other spec readers in `lib/utils.js`, unless an existing helper already covers generic `## Heading` extraction. The section is plain markdown bullets. The agent reads them verbatim as part of the spec; no semantic enforcement, just presentation. Trust is at the human level (you write the line, you trust the agent to honour it).

### Tmux session vs snapshot agent
Today `sweepEntity` probes a single `expectedSessionName` / `expectedResearchSessionName`. Modern launches use `{repo}-f{id}-{role}-{agent}`. Part A must either import a shared naming helper (if the “no cross-import” rule between supervisor and worktree is relaxed for a tiny shared module) **or** port the role-aware existence check into `lib/supervisor.js` so idle detection and liveness agree on whether the pane is actually there. Document the chosen approach in the implementation PR.

### Audit trail
Every commit made under a pre-auth carries a footer:
```
Pre-authorised-by: may raise CEILING by up to +40 LOC
```
This mirrors the existing `Aigon-Agent-ID: cx` footer convention. `git log --grep='Pre-authorised-by:'` gives you a complete audit of every deviation the agent took under standing orders.

### Why combine the two parts in one feature
They solve the same class of problem from opposite sides: idle detection catches "agent stopped and I need to unblock it"; pre-auth avoids "agent stopped on something I'd have said yes to anyway." Shipping both makes the autonomous-run experience meaningfully better; shipping either alone leaves half the problem. They also share almost no code — detector is `lib/supervisor.js`, pre-auth is spec template + `feature-do.md` + a 10-line section reader.

### Risk and mitigation
- **Idle detector false positives**: a long-running `npm test` on a slow machine could trick the detector. Mitigation: thresholds are user-configurable, and "soft" level (10min) is just a badge — not disruptive. Only `notify` (20min) fires anything.
- **Pre-auth abuse by agents**: an agent over-interpreting a pre-auth line to justify broader deviations. Mitigation: the audit footer makes this visible in `git log`; spec authors learn to write bounded lines ("up to +40 LOC", not "as needed"). Failure mode is visible and correctable, not silent.
- **Pre-auth creep**: users copy-pasting generous pre-auths into every spec. Mitigation: social, not technical. This is a feature spec mechanism; abuse surfaces as "why did the agent do X without asking?" and gets caught in review.

## Dependencies
- None hard. F283 (closed) produced the engine-event machinery the idle detector reads from.
- Runs independently of all currently-in-flight features (F288, F289, F290, F291, F292, legacy-compat-cleanup).

## Out of Scope
- Auto-approval / auto-resolution of stuck agents. This feature detects and notifies; it never resolves.
- Parsing tmux pane content to detect specific UI prompts (codex awaiter, cursor composer accept). Too brittle across agents.
- A DSL for pre-auth lines. Plain markdown bullets only. "up to +40 LOC" is a human readable bound, not a parsed constraint.
- Per-global pre-auths (a config file of standing orders that apply to every feature). Intentional — pre-auth must be per-feature, authored and reviewed with the spec.
- SMS / email / Slack notifications. Desktop notifications only; other channels are a follow-up.
- Supervisor service restart / auto-recovery logic. This feature ONLY adds idle-status observation.

## Configuration defaults (v1 — resolve Open Questions at implementation time)
- **Threshold keys** live in **global** `~/.aigon/config.json` under a single object (e.g. `supervisor.idleThresholdsMinutes: { soft, notify, sticky }`) with defaults 10 / 20 / 60. Per-repo overrides are out of scope unless trivial to add via existing `loadProjectConfig` merge rules.
- **Desktop notifications** for idle-stuck fire only when `supervisorNotifications: true` (or the same flag already used for dead-agent notifications, if one exists — reuse, do not invent a second knob).
- **Dashboard badge click → pane tail** is explicitly **out of scope for v1**; badge + optional notification + notifications panel row only.
- **`## Pre-authorised` placement** in the scaffolded feature template: immediately after `## Validation`, before `## Technical Approach` (operational context, not design detail).

## Open Questions
- If both `do` and `review` tmux sessions exist for one agent (hand-off window), should idle detection consider the **newest** mtime across roles or only the role matching the snapshot’s implied active task? (Default lean: any alive role session for that agent keeps the entity “active”; idle clock resets on progress from **any** role — document if different.)

## Related
- Triggered by: 2026-04-21 F291 overnight idle — cc hit test-budget ceiling, correctly stopped to ask, sat for hours. Same session saw F282 cx awaiter approval stall for 17 min earlier.
- `lib/supervisor.js` already computes agent liveness (alive/stale/dead). This feature adds one more dimension (progress/idle) to the existing state.
- CLAUDE.md rule T3 — the rule that (correctly) made cc stop. This feature doesn't weaken T3; it gives the user a channel to pre-authorise routine exceptions per-feature.
- Write-Path Contract — idle state is DERIVED (read path). No new write path; reads existing events.jsonl timestamps + existing heartbeat files.
- Notifications panel in the dashboard (visible at top-right in screenshots) — this feature extends what that panel displays; doesn't reshape it.
