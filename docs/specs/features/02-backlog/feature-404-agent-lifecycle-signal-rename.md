---
complexity: very-high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T02:23:14.834Z", actor: "cli/feature-prioritise" }
---

# Feature: agent lifecycle signal rename

## Summary

The `submitted` signal is legacy terminology from a removed workflow stage (`04-submitted/` folder). Today it means "I finished" but says nothing about *what* the agent finished. Worse, it does double duty: it signals both the end of initial implementation AND the end of a code revision pass, forcing the workflow engine to infer which from surrounding context. This feature renames all completion signals to follow the consistent `[role]-complete` pattern already established by `review-complete`, and collapses the `feedback-addressed` + `submitted` pair into a single `revision-complete` signal. Backward-compat aliases keep live sessions from breaking mid-flight.

## User Stories

- As a developer reading the dashboard, I can see "Implementation complete" and "Revision complete" instead of "Submitted", making the pipeline state immediately obvious without knowing aigon internals.
- As an agent running a revision pass, I run `aigon agent-status revision-complete` when I finish — one command, one clear meaning, not the ambiguous `submitted`.
- As a developer building the dashboard "Mark X complete" escape hatches (F_NEXT), I have distinct, unambiguous signal names for every scenario: `implementation-complete`, `revision-complete`, `review-complete`, `spec-review-complete`, `research-complete`.
- As a user with a live session mid-flight that still calls `aigon agent-status submitted`, the command still works and the workflow still advances correctly.

## Acceptance Criteria

- [ ] `aigon agent-status implementation-complete` accepted; advances workflow identically to current `submitted` (first implementation pass)
- [ ] `aigon agent-status revision-complete` accepted; replaces `feedback-addressed` + `submitted` pair — a single command ends the revision pass
- [ ] `aigon agent-status spec-review-complete` accepted for spec-review sessions
- [ ] `aigon agent-status research-complete` accepted for research finding submissions
- [ ] `aigon agent-status submitted` still works as a deprecated alias (exits 0, emits a deprecation warning, advances workflow correctly)
- [ ] `aigon agent-status feedback-addressed` still works as a deprecated no-op alias (exits 0, emits deprecation warning, does NOT advance workflow — the agent must still call `revision-complete`)
- [ ] Shell EXIT trap in `buildAgentCommand` emits `implementation-complete` for `taskType='do'` and `revision-complete` for `taskType='revise'`
- [ ] A new `revise` taskType is accepted by `buildAgentCommand` and `createDetachedTmuxSession`; the tmux session role for revision sessions is `revise`
- [ ] `VALID_TMUX_ROLES` updated to include `revise`
- [ ] `check-agent-submitted` CC Stop hook accepts both `submitted` and `implementation-complete` as valid submitted states
- [ ] `check-agent-signal` GG AfterAgent hook warns on missing signal using new names
- [ ] All five agent templates (`cc.json`, `gg.json`, `cx.json`, `cu.json`, `km.json`) `implementPrompt`, `reviewPrompt`, and `reviewCheckPrompt` updated where relevant
- [ ] `AGENT_TEAMS_FEATURE_NOTE`, `AGENT_TEAMS_RESEARCH_NOTE`, and `AGENT_PITFALLS` placeholders in all agent JSONs updated to use new signal names
- [ ] `templates/generic/commands/feature-do.md`, `feature-code-review.md`, `feature-code-revise.md`, `research-do.md`, and all other relevant slash command templates updated
- [ ] `AGENTS.md` lifecycle section updated to new signal names
- [ ] `npm test` passes; no snapshot tests fail due to renamed signals
- [ ] A live snapshot that contains old `submitted`/`feedback-addressed`-based events reads correctly under the new code (read-path backward compat)

## Validation

```bash
node -c aigon-cli.js
node -c lib/commands/misc.js
node -c lib/worktree.js
npm run test:iterate
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May update all files under `templates/generic/commands/` that reference `agent-status submitted` or `feedback-addressed` in one pass without stopping to confirm each file.
- May update all agent JSON files under `templates/agents/` that contain `AGENT_PITFALLS`, `AGENT_TEAMS_FEATURE_NOTE`, or `AGENT_TEAMS_RESEARCH_NOTE` placeholders in one pass.

## Technical Approach

### Signal surface (CLI layer — `lib/commands/misc.js`)

Add to `validStatuses`:
```
implementation-complete  →  maps to same workflow call as current `submitted`
revision-complete        →  new; collapses feedback-addressed + submitted
spec-review-complete     →  maps to same workflow call as current spec-review signalling
research-complete        →  maps to same workflow call as current `submitted` for research entities
```

Keep `submitted` and `feedback-addressed` as aliases with a `console.warn` deprecation notice. `feedback-addressed` becomes a no-op alias — it warns and exits 0 without advancing state, since `revision-complete` is now the single signal for that transition.

### Shell trap (`lib/worktree.js`)

Current:
```js
const successStatus = taskType === 'review' ? 'review-complete' : 'submitted';
```

New:
```js
const successStatus = {
  review: 'review-complete',
  'spec-review': 'spec-review-complete',
  revise: 'revision-complete',
  do: 'implementation-complete',
}[taskType] ?? 'implementation-complete';
```

Add `revise` to `VALID_TMUX_ROLES`. The `buildAgentCommand` and `createDetachedTmuxSession` call sites that launch revision sessions must pass `taskType='revise'`. The revision session also uses a different `reviewCheckPrompt` command path — confirm the agent config `reviewCheckPrompt` is wired to the correct slash command for revision.

The starting signal (what the trap emits at session open) also needs updating:
```js
// currently:
`aigon agent-status ${taskType === 'review' ? 'reviewing' : 'implementing'} 2>/dev/null || true`

// new:
const startStatus = {
  review: 'reviewing',
  'spec-review': 'spec-reviewing',
  revise: 'revising',
  do: 'implementing',
}[taskType] ?? 'implementing';
```

Note: `spec-reviewing` and `revising` are new start-of-session statuses — add them to `validStatuses` alongside the completion signals.

### Workflow engine (`lib/workflow-core/engine.js`)

Two options — choose Option A for lower risk:

**Option A (preferred):** Keep internal event types (`signal.agent_ready`, `signal.agent_submitted`, etc.) stable. Only the CLI surface renames. The `misc.js` handler maps new names to the same `wf.*` calls. No snapshot migration needed. Dashboard event display strings update separately.

**Option B:** Rename internal events to `feature.implementation.completed`, `feature.revision.completed` etc. Requires snapshot migration script and updates to all event consumers (supervisor, heartbeat, analytics, dashboard). Do not choose this unless Option A proves insufficient.

### `check-agent-submitted` (`lib/commands/misc.js`)

Update condition from:
```js
if (agentState && agentState.status === 'submitted') {
```
to:
```js
if (agentState && (agentState.status === 'submitted' || agentState.status === 'implementation-complete')) {
```

### Agent status file read-back

`readAgentStatus` returns whatever was written. The agent-status file records the status string directly. New sessions write `implementation-complete`; old sessions in-flight wrote `submitted`. The check above handles both.

### Template updates (high surface area — do in one pass)

Files to update (search for `agent-status submitted` and `feedback-addressed`):
- `templates/generic/commands/feature-do.md`
- `templates/generic/commands/feature-code-revise.md`
- `templates/generic/commands/feature-code-review.md`
- `templates/generic/commands/research-do.md`
- `templates/generic/commands/research-review.md` (if it references submitted)
- All `AGENT_PITFALLS`, `AGENT_TEAMS_FEATURE_NOTE`, `AGENT_TEAMS_RESEARCH_NOTE` blocks in `templates/agents/*.json`

Also update `AGENTS.md` lifecycle section, and the `gemini.md` / `cc.md` agent-specific notes under `docs/agents/`.

## Dependencies

None — this is the foundation feature. The dashboard escape-hatch feature (F_NEXT) depends on this.

## Out of Scope

- Renaming internal workflow event types (`signal.agent_ready` etc.) — that is Option B above and is deferred
- Changing the dashboard display labels for existing events (separate cosmetic pass)
- Migrating existing on-disk snapshots — backward compat aliases make this unnecessary

## Open Questions

- Should `revising` (the start-of-revision-session signal) be added? It adds symmetry but also adds a new status to validate/display. Recommended: yes, for parity with `reviewing`.
- Does `spec-reviewing` similarly need a start signal? Same answer — add for parity.

## Related

- Set: agent-lifecycle-signals
- Prior features in set: —
- Next in set: dashboard workflow escape hatches (depends on this feature)
