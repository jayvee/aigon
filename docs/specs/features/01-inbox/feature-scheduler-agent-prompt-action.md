---
complexity: high
agent: cc
---

# Feature: scheduler-agent-prompt-action

## Summary

Add a third action kind, `agent_prompt`, to Aigon's scheduler (`lib/scheduled-kickoff.js`) so the scheduler can spawn a fresh agent session that runs an arbitrary prompt or `/<skill>` command — not just feature/research lifecycle commands. Optionally accept a cron expression so the same job re-arms after firing, enabling true recurring agent runs without leaning on system cron. First user is the weekly `/security-review` digest, but the capability is generic: any periodic AI task (architecture audit, dependency-update review, TODO sweep, security review) becomes a one-line schedule.

The scheduler stays dumb: it knows nothing about security, reviews, or any specific workflow. It spawns the agent and walks away. The agent's prompt is responsible for whatever the agent does in-session, including filing features via `afc` for any work it discovers (per the project rule: `afbc` = real user voice; agent-discovered work files `afc`).

This feature is the *enabler*. It does not configure the security review itself — that's a one-liner once this lands.

## User Stories
- [ ] As the maintainer, I can schedule a fresh Claude Code session to run `/security-review` on the aigon repo every Monday at 06:00 with a single CLI command — no nested-Claude problem because the scheduler runs outside any session.
- [ ] As the maintainer, I can schedule any other slash command (e.g. a future `/architecture-audit`) on a recurring or one-shot basis using the same machinery.
- [ ] As the maintainer, I can list all scheduled agent prompts via `aigon schedule list` alongside existing feature/research jobs.
- [ ] As the maintainer, I can cancel a recurring agent prompt schedule via `aigon schedule cancel <jobId>` and it stops re-arming.
- [ ] As a future contributor, I can read the docs and understand: when do I use `agent_prompt` vs `feature_autonomous` vs `research_start`?

## Acceptance Criteria
- [ ] `lib/scheduled-kickoff.js` accepts a third value for `kind`: `agent_prompt`. Existing `feature_autonomous` and `research_start` paths are unchanged.
- [ ] CLI: `aigon schedule add agent_prompt --run-at=<iso8601> --agent=<id> --prompt=<string> [--cron=<expr>] [--label=<slug>] [--repo=<path>]`.
- [ ] `--prompt` accepts either a literal string (treated as the first user message in the session) or a slash command starting with `/` (e.g. `/security-review`) — both are passed verbatim to the agent.
- [ ] `--agent` must be a known agent id (validated via `agentRegistry.getAllAgentIds()`); unknown agents fail with the same error format as today's payload validators.
- [ ] `--label` is a free-text slug (max 60 chars, `[a-z0-9-]+`) used as a synthetic `entityId` in the job store and shown in `aigon schedule list`. If omitted, defaults to `prompt-<short-uuid>`. This avoids changing the job store schema (which currently requires numeric `entityId`).
- [ ] `--cron` (optional) is a 5-field cron expression. When set, after a successful fire the scheduler enqueues the next runAt computed from the cron expression. If parsing fails, the job is rejected at add time with a clear error.
- [ ] `assertEntitySchedulable` is updated: `agent_prompt` short-circuits the entity-existence check (there is no entity) and only validates the agent id and label format.
- [ ] `buildSpawnArgvForJob` is updated with a third branch that returns the argv for a new internal CLI subcommand: `aigon agent-launch --agent <id> --repo <path> --prompt <string> [--label <slug>]`. The scheduler still uses `spawnSync(process.execPath, [cliEntryPath, ...argv])` — same machinery as today.
- [ ] New CLI: `aigon agent-launch` (in `lib/commands/agent-launch.js` or wherever the existing session-launch primitives live) — spawns a fresh agent session in the target repo using the same iTerm/tmux tab convention the rest of Aigon uses (per the "iTerm2 tabs not windows" rule). The session is given the prompt as its first input. No worktree is created — `agent_prompt` runs in the main repo by default.
- [ ] After a successful fire of an `agent_prompt` job with `--cron`, a follow-up job is enqueued with the same `kind`, `agent`, `prompt`, `label`, `cron`, and the next runAt computed from the cron expression. If enqueue fails, the original job is still marked `fired` but the failure is logged.
- [ ] `buildPendingScheduleIndex` is unchanged — it only indexes feature/research jobs for the dashboard schedule glyph. (`agent_prompt` jobs do not have an entity so they don't appear on entity cards. They appear only in `aigon schedule list`.)
- [ ] `aigon schedule list` displays `agent_prompt` rows in the same format as the existing kinds, using the label as the entity column: e.g. `<jobId>  pending     agent_prompt  #security-review-weekly  runAt=...`.
- [ ] All existing tests pass; new unit tests cover: agent_prompt validation (good + bad agent, good + bad label, good + bad cron), argv build, cron-based re-enqueue (mocked clock), and the assert short-circuit.
- [ ] Docs: a new section in `docs/architecture.md` (or wherever the scheduler is documented today) describing the three kinds with a one-line "when to use" for each.
- [ ] `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.

## Validation
```bash
node --check aigon-cli.js
node -e "require('./lib/scheduled-kickoff.js')"
aigon schedule add agent_prompt --run-at="2099-12-31T23:59:00Z" --agent=cc --prompt="/security-review" --label=test-dry-run
aigon schedule list
aigon schedule cancel <jobId-from-above>
```

## Pre-authorised
- May raise `scripts/check-test-budget.sh` CEILING by up to +80 LOC for the new validators, runner branch, cron re-enqueue logic, and unit tests.
- May add a single small npm dependency for cron expression parsing (`cron-parser` or equivalent — must be ≤50KB unpacked, MIT/Apache, ≥1M weekly downloads). Document the choice in the implementation log.
- May add `agent-launch` as a top-level `aigon` subcommand; if a name collision exists, append `--prompt` mode to whatever command currently owns session spawning instead.

## Technical Approach

### Job store schema change
The current job shape requires `entityId` to be numeric (`/^\d+$/`). For `agent_prompt`, there's no entity. Two options considered:

- **Option A (chosen)**: keep the field but allow string slugs when `kind === 'agent_prompt'`. The validator branches on kind. Backwards compatible — existing rows are untouched.
- Option B: add a separate `label` field alongside `entityId` and make `entityId` nullable. More invasive; touches `buildPendingScheduleIndex` and dashboard reads.

Going with A. The synthetic `entityId` is the user-supplied `--label` (or auto-generated `prompt-<uuid8>`).

### New job payload shape
```js
// kind: 'agent_prompt'
payload = {
  agentId: 'cc',                      // validated against agentRegistry
  prompt: '/security-review',         // verbatim, slash or free text
  cron: '0 6 * * 1' | null,           // optional; if set, re-arm after fire
  label: 'security-review-weekly',    // mirrors entityId; kept in payload for round-trip clarity
}
```

### Runner branch
`buildSpawnArgvForJob` returns `['agent-launch', '--agent', agentId, '--repo', repoPath, '--prompt', prompt, '--label', label]`. The existing `runOneDueJob` machinery shells out to the aigon CLI with this argv — identical mechanism to today's two kinds.

### `aigon agent-launch` (new CLI subcommand)
This is the primitive that opens a fresh iTerm tab in `--repo`, launches the agent CLI for `--agent`, and writes `--prompt` as the first user input. Implementation should reuse whatever the existing feature-start / research-start path uses to open agent sessions — this is **not** a from-scratch session-spawning system. If that machinery currently only supports "feature/research session", a small extraction pass is required to make it usable here too.

### Cron re-enqueue
After `runOneDueJob` succeeds, `processRepoDueJobs` checks if the fired job had `payload.cron`. If yes, parse it, compute the next runAt strictly greater than the just-fired runAt, and add a new pending job via `addJob` with the same payload + new runAt. The old job's status remains `fired` (immutable). If cron parse fails on re-enqueue, log and skip — do not crash the poller.

### Why `complexity: high`
- Engine module (`scheduled-kickoff.js`) gets a new branch in 4 functions: `assertEntitySchedulable`, `addJob`'s payload validator, `buildSpawnArgvForJob`, `processRepoDueJobs` (cron re-enqueue).
- Job store schema gains a new validation rule (string-or-numeric entityId). Must follow the **Write-path contract** rule — every read path that calls `entityId` must tolerate a slug, and the dashboard schedule index already does the right thing (it just doesn't index agent_prompt jobs).
- New top-level CLI subcommand (`agent-launch`) wired into `aigon-cli.js`.
- New npm dependency (cron parser).
- Cross-cuts engine + CLI + docs.

## Dependencies
- Existing `lib/scheduled-kickoff.js` (extension target).
- Existing `lib/commands/schedule.js` (CLI dispatch — third subcommand branch).
- Existing `agentRegistry` (agent id validation).
- Existing session-spawning primitive (TBD path — likely in `lib/session-sidecar.js` or whatever `feature-start` / `research-start` calls into for the iTerm tab).
- One small new npm package for cron parsing (justified above).
- No dashboard changes required for v1 — `agent_prompt` is CLI-only.

## Out of Scope
- **Replacing `lib/recurring.js`** (the template-based weekly feature spawner). That serves a different use case (auto-create *features* on a cadence). `agent_prompt` runs an *agent in a session*; no spec is created. Both can coexist.
- **Dashboard UI** for managing agent_prompt schedules. CLI-only for v1; dashboard view is a follow-up if usage justifies it.
- **Capturing session output / transcripts** in the scheduler. The agent is responsible for its own outputs (files it writes, features it creates via `afc`, etc.). Keeping the scheduler dumb is the design.
- **Worktree sessions for agent_prompt**. The agent runs in the main repo; if a particular use case needs a worktree, the prompt itself can call `aigon` commands to set one up. v1 is main-repo only.
- **Supersedes F368/F369** — handled in a separate deletion feature.
- **Configuring the actual security review schedule** — that's a one-liner once this lands; no spec needed.

## Open Questions
- What's the existing session-spawning entry point we should reuse? Need to read `feature-start` / `research-start` paths during implementation. If it turns out there's no clean primitive, this feature grows to include extracting one — flag at start.
- Do we need a `--once` flag for `agent_prompt` to make the contrast with `--cron` explicit? Or is "no cron = one-shot" sufficient? Lean toward the latter — matches existing kinds.
- Should there be a max-history cap on completed `agent_prompt` jobs in the store? Recurring runs every Monday for a year = 52 `fired` rows. Probably fine; revisit if the store grows pathological.
- Where does `aigon agent-launch` live — `lib/commands/agent-launch.js` (new file) or extend `lib/commands/schedule.js`? Lean toward new file; the existing `lib/commands/setup.js` install flow may already have agent-launch pieces worth pulling out.

## Related
- Research: none.
- Set: this feature plus a follow-up deletion feature for F368/F369 form an implicit set. Will create the deletion feature once this one lands.
- Prior features in set: F368 (weekly-security-scanner) — superseded; F369 (auto-spawned recurring) — to be cleaned up.
