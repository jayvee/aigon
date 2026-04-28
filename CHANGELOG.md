# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

> **Note on entries from v2.19 onwards:** the changelog was backfilled in bulk from git history on 2026-04-07 ahead of the public launch. Entries are grouped by theme and dated by month rather than per-patch. For commit-level detail, see `git log v2.18.0..HEAD` or browse the [git tags](https://github.com/jayvee/aigon/tags).

## [2.61.0] — 2026-04-28

Install manifest tracking (F422). The aigon installer now records every
file it writes (path + sha256 + version + timestamp) under
`.aigon/install-manifest.json`, and a migration backfills the manifest for
repos installed before this version. Lays the groundwork for `aigon
uninstall` (cleanly removes only aigon-owned files), drift detection
(warn when an installed file diverges from the shipped template), and the
brewboard-seed install-contract refresh queued behind it (F423, backlog).

### Added

- **`.aigon/install-manifest.json`** — tracks every file written by `install-agent` / `update`. Each entry: `{ path, sha256, version, installedAt }`. Written by the existing `safeWrite` / `safeWriteWithStatus` helpers — no separate writer path to keep in sync.
- **`aigon uninstall [--dry-run]`** — uses the manifest to remove aigon-owned files cleanly (only files aigon wrote, leaving any user additions in the same dirs alone). `--dry-run` prints the list without deleting; the regular path prompts for confirmation.
- **2.61.0 migration** — backfills the manifest for legacy installs by scanning the standard install-path roots (`.aigon/docs/`, `.agents/`, `.claude/{commands/aigon,skills}/`, `.cursor/{commands,rules}/`, `.codex/`, `.gemini/`, plus alias files directly under `.claude/`) and hashing each file with the current `aigonVersion`. Idempotent: skips silently if `.aigon/install-manifest.json` already exists.

### Internal

- Both repos that dogfood aigon (`aigon`, `aigon-pro`) had their `.aigon/version` lagging behind the registered migrations because each migration version-bump never reached `package.json`. This release brings package.json, `.aigon/version`, and the highest registered migration into a single coherent number again.

## [2.60.0] — 2026-04-28

Vendored-docs layout (F421), no more consumer AGENTS.md scaffolding (F420),
the `aigon onboarding` → `aigon setup` rename (F416), the perf-bench
matrix sweep, and follow-on planning/transcript work (F424–F429).
Version bump aligns `package.json` with the `2.60.0` migration that already
shipped in `lib/migration.js`. ~110 commits since v2.55.0 (also cut today).

### Added

#### Docs layout (F421)

- **Vendored docs at `.aigon/docs/`** — `install-agent` and `update` now write `development_workflow.md`, `feature-sets.md`, and per-agent notes (`agents/<id>.md`) under `.aigon/docs/` instead of co-mingling with the consumer's `docs/` folder. The consumer's own `docs/` is never touched.
- **`doctor --fix` 2.60.0 migration** — moves legacy `docs/development_workflow.md`, `docs/feature-sets.md`, and pristine `docs/agents/<id>.md` (anything carrying the `<!-- AIGON_START -->` marker) into `.aigon/docs/`. Edited copies are left in place with a manual-merge warning. Idempotent.

#### Onboarding (F416, F418, F426)

- **`aigon onboarding` → `aigon setup` (F416)** — the user-facing command renamed for parity with the spec ("setup wizard"). The legacy `onboarding` command stays as a deprecated alias for one more release; remove on next major.
- **Brewboard demo step in the onboarding wizard (F418)** — the wizard now offers to clone a small reference seed repo and run a real `feature-do` against it, so a first-time user sees Aigon end-to-end without writing their own spec first.
- **Onboarding decision tree + smoke test (F426)** — guided picker for "which agent should I install" + a quick smoke test that confirms the agent CLI is reachable and emits the right hooks before the wizard reports success.

#### Planning + transcripts (F424, F425, F427, F428, F429)

- **Auto plan-mode on spec creation (F424)** — `afc` / `arc` prompt for Shift+Tab plan-mode before drafting and persist the plan path in the new spec.
- **Spec planning-context capture (F425)** — `feature-create` / `research-create` accept a `planning_context:` frontmatter pointer; `feature-start` copies it into the implementation log so the agent's plan-mode reasoning is preserved across hand-off.
- **Transcript read model + CLI (F427)** — `aigon transcripts list / show <id>` surfaces captured agent sessions joined with telemetry. Backed by a session-strategy registry per agent, so agents that don't expose a transcript path return a "not-captured" record rather than a hard error.
- **Live log panel for `feature-close` (F428)** — dashboard panel that streams the close-out log live during the merge step. Dismisses cleanly on network/HTTP failure rather than getting stuck on an empty frame.
- **Durable hot-tier transcript store (F429)** — the tmux sidecar's transcript snapshot is now persisted under `.aigon/state/transcripts/<feature>/<agent>.jsonl`, so transcripts survive past the live tmux pane and can be replayed later.

#### Performance + diagnostics

- **`aigon perf-bench --model / --effort / --all`** — single command can now sweep an agent matrix (every model × every effort) against the brewboard seed and emit aggregate `all-<seed>-*.json` artifacts. Pro reads these as a fallback when no per-pair JSON exists, so failure context (errors, timeouts) is preserved even when individual runs aborted before writing their own file.
- **Brewboard-review seed** — second deterministic seed repo with planted weaknesses, used for benchmarking the review path (not just implement).
- **`aigon agent-probe`** — on-demand agent/model health check. Confirms the CLI is reachable, the requested model is callable, and that hooks fire before scheduling real work.

#### Dashboard

- **Per-domain dashboard routes (F410)** — split the monolithic `lib/dashboard-server.js` into `lib/dashboard-routes/{config,benchmarks,transcripts,...}.js`. Pro layers its own routes on top of the same registry without touching OSS code.
- **Pro benchmark matrix UI** — agent stripe colours, fast/mid/slow buckets, relative-speed bars, fail pills, summary stat grid, source-repo banner with a yellow fallback variant when the requested repo had no benchmark JSON and Pro fell back to the first conductor-registered repo with data.

### Changed

- **BREAKING: aigon no longer scaffolds consumer `AGENTS.md` (F420)** — the `<!-- AIGON_START -->...<!-- AIGON_END -->` block is removed by the 2.59.0 migration; consumer `AGENTS.md` is now fully user-owned. `docs/aigon-project.md` is also removed (2.59.1) — aigon no longer reads it.
- **All shipped templates retargeted to `.aigon/docs/`** — `feature-template-agent-onboard.md`, `templates/generic/{agents-md.md,cursor-rule.mdc,prompt.md,skill.md,docs/agent.md}` and the per-agent doc template have every reference to `docs/development_workflow.md` / `docs/agents/<id>.md` rewritten so freshly generated agent install artifacts point at the new layout.

### Migration notes

- Existing repos pick up the new layout automatically on the next `aigon install-agent` or `aigon update` run (the 2.60.0 migration runs first).
- If `docs/development_workflow.md` was hand-edited, the migration leaves it in place and prints a warning — reconcile manually, then move it to `.aigon/docs/`.
- The `aigon onboarding` alias is preserved this release; scripts that call it will continue to work but should switch to `aigon setup`.

## [2.55.0] — 2026-04-28

PTY terminal in the dashboard, agent lifecycle signal rename (F404), research-context awareness across feature/review commands, and dashboard escape hatches for stalled signals. ~75 commits since v2.54.6.

### Added

- **PTY terminal via WebSocket (F356 MVP)** — interactive terminal panel in the dashboard backed by `node-pty` over WebSocket. Includes zoom, copy, wider panel, and a 300 ms repaint nudge for full-screen TUIs.
- **Agent session IDs recorded in tmux sidecars (F357)** — session sidecar JSON now carries the agent's session ID so future tooling can correlate dashboard rows to live panes deterministically.
- **Weekly security scanner (F368)** — recurring feature that audits the codebase for vulnerabilities and files findings as inbox features.
- **Monthly top-3 simplifications recurring feature** — audits the codebase for highest-leverage simplifications across maintainability, readability, AI-agent clarity, extensibility, and performance; auto-files the top three to inbox for triage. First run: F412 (`top-3-simplifications-2026-04`).
- **Monthly competitive refresh recurring feature** — periodic scan of the competitive landscape, auto-filed for triage.
- **Dashboard escape hatches for stalled agent completion signals (F405)** — operator-facing buttons to unblock features when an agent has stopped emitting progress signals; backend owns the escape-hatch logic, dashboard surfaces it.
- **Research context wired into feature-do, code-review, and spec-review (F408)** — features can declare a `research:` frontmatter link to research topics; `feature-do`, `feature-code-review`, and `feature-spec-review` now inject that research synthesis into the agent's context.
- **Per-agent cost data surfaced in dashboard (F402)** — agent-level cost figures are pulled into the dashboard view.
- **Execution mode badge in dashboard monitor view (F409)** — at-a-glance distinction between Drive / Fleet / autonomous runs on monitor cards.
- **Sync conflict detection** — `aigon sync` now detects and logs conflicts; register test added.
- **Scoped iterate runner + smoke set + parallel test runner (WIP)** — foundation for the `npm run test:iterate` per-iteration gate distinct from the pre-push gate.
- **Gemini `approvalMode = yolo` set globally and via `install-agent`** — removes the per-prompt approval friction for Gemini sessions.
- **Mock-agent profiles + dashboard E2E failure-mode spec** — exercises the new escape-hatch and signal paths.

### Changed

- **BREAKING: agent lifecycle completion signals renamed (F404)** — terminal vocabulary across the agent-status pipeline was unified. Dashboard labels were aligned to the new vocabulary in F410. If you have external tooling that grep'd the old signal names, update it; in-repo consumers were migrated in the same release.
- **`feature-do` front-loads its run instruction** — stops agents from "pre-flighting" the spec before getting the directive to act on it.
- **Backlog cards restore spec-review session info** — and the server-restart cascade no longer drops it.
- **Test discovery** — integration and workflow tests are now auto-discovered via globs; `review` test globs are guarded against empty-directory literal expansion.

### Fixed

- **Gemini hooks emit proper JSON** — `check-version`, `project-context`, and `check-agent-signal` `--json` modes now emit `{ systemMessage }` / `{ hookSpecificOutput: { additionalContext } }` so context actually reaches the LLM rather than just the UI. `install-agent` pre-trusts hooks in `~/.gemini/trusted_hooks.json` to silence the "project-level hooks detected" startup warning. Hook merge upserts by base command name so re-installs replace old commands instead of duplicating them.
- **OpenCode prompt routing** — `--model` is preserved and prompts route via `opencode --prompt` (was being silently dropped).
- **Recurring tasks blocked in worktrees** — and `getNextId` hardened with a git-based ID scan to avoid ID collisions when multiple worktrees coexist.
- **PTY full-screen TUI repaint** — restored the 300 ms repaint nudge that was lost in an earlier refactor.
- **`node-pty` spawn-helper permissions** on macOS.
- **`seed-reset` provisioning** — awaits async `install-agent` and uses `git add -A` so the seed demo repo settles deterministically.
- **F405 escape-hatch read-model and E2E** — corrected the read-side projection so the dashboard surfaces the right escape-hatch state.
- **Dashboard agent picker** shrunk and the matrix stats join dropped to keep the modal lightweight.
- **Dead ternary** removed in `buildResearchContextSection`.

## [2.54.6] — 2026-04-24

### Fixed

- **"Finished (unconfirmed)" flash on feature start** — when a feature's tmux session ended previously, the `sessionEnded` flag persisted in the agent status file. Re-starting the feature showed "Finished (unconfirmed)" on the dashboard for 5–10 s until the new session's first heartbeat arrived. `feature-start` now clears `sessionEnded`/`sessionEndedAt` immediately after creating the new tmux session.

### Onboarding wizard improvements

- Wizard registers the brewboard repo with the dashboard after the server starts (fix)
- Wizard server runs in the background; `sudo` used for Linux agent installs (fix)
- Agent CLI authentication step added to the onboarding flow
- Various UX fixes identified during Docker install walkthrough

### Feature close failures are now persisted and actionable

`aigon feature-close` now emits a `feature_close.failed` workflow event whenever the close exits non-zero (merge conflicts, security scan, push failures, etc.). The event payload carries `kind`, `conflictFiles[]`, `stderrTail`, and `exitCode` — data that previously vanished with the conductor's tmux pane.

- **Persistent diagnostics**: `events.jsonl` is the durable record. Even days later, you can see exactly which files conflicted.
- **Dashboard "Resolve & close"**: When `lastCloseFailure.kind === 'merge-conflict'`, the card's "Close" button is replaced with a **"Resolve & close"** button. Clicking it opens an agent in the worktree with a pre-injected prompt naming the conflict files and instructing a `git rebase` + retry.
- **Inline failure line**: The card renders a compact warning line (e.g. `⚠ Merge conflict in lib/commands/setup.js, feature-335-…md`) visible without expanding any panel.
- **Auto-cleared on success**: `lastCloseFailure` is cleared from the snapshot when a subsequent `feature.closed` event lands.

### BREAKING: `review-check` renamed to `revise`

The author-turn step after a reviewer critiques a spec or code is now called **revise** (verb) / **revision** (stage). Commands, shortcuts, stage types, and dashboard buttons all use the new vocabulary.

**Run `aigon update` to migrate in-flight features.** The migration rewrites `.aigon/workflows/**/snapshot.json` entries automatically; you do not need to touch your data manually.

**Commands and shortcuts renamed (old names removed — no aliases):**

| Old | New |
|-----|-----|
| `aigon feature-code-review-check` / `/afrc` | `aigon feature-code-revise` / `/afrv` |
| `aigon feature-spec-review-check` / `/afsrc` | `aigon feature-spec-revise` / `/afsrv` |
| `aigon research-spec-review-check` / `/arsrc` | `aigon research-spec-revise` / `/arsrv` |
| `aigon feature-review-check` | removed (was deprecated alias for code-review-check) |

**Any scripts, hooks, or docs referencing the old command names or shortcuts (`afsrc`, `afrc`, `arsrc`) must be updated.**

Dashboard buttons: "Check Spec Review" → **"Spec Revise"**; "Check Code Review" → **"Code Revise"**.

Autonomous-mode stage type `counter-review` → `revision`. Workflow definition files with `"type": "counter-review"` are rewritten by `aigon update`.

## [2.54.1] - 2026-04-23

Autonomous **feature sets** (SetConductor) and solo AutoConductor hardening: the outer set loop can advance when members use review → counter-review → close, and operators can peek the set orchestrator session from the dashboard.

### Fixed
- **SetConductor inner `feature-autonomous-start`** spawns the repo-root `aigon-cli.js` (regression: a wrong `..` depth exited the loop immediately, so the set run never saw per-feature AutoConductor finish).
- **Stale `running` in `feature-*-auto.json`** no longer blocks a fresh inner AutoConductor when the per-feature `*-f{id}-auto` tmux session is gone; liveness is tied to real tmux.
- **Solo AutoConductor after code review** — if the implementer re-runs `agent-status submitted` (or updates status / `updatedAt`) instead of the exact `feedback-addressed` value, the controller now treats that as progress, runs `feature-close`, and marks the inner run `completed` so **SetConductor** can move to the next set member. (Previously the outer loop waited forever with “Counter-review running / Close waiting”.)
- **Post-`feature-close` snapshot wait** — increased poll budget so slow merges do not spuriously fail the inner run.

### Added
- **Dashboard peek** (eye icon) for the set AutoConductor tmux session (e.g. `repo-s{slug}-auto`) in Monitor set cards and Pipeline “group by set” headers, consistent with per-feature AutoConductor peek.
- **Gemini budget poller** — `parseGeminiFooterPlanQuota` and tighter `parseGeminiModelUsage` handling for real `/model` output; integration tests extended.

### Changed
- `workflow-snapshot-adapter` exposes fresh snapshot reads for SetConductor completion checks; session sidecar and `worktree` matching for set `S` entity type.

## [2.54.0] - 2026-04-22

Autonomous-mode reliability and multi-agent resilience. 332 commits since v2.53.0, 26 features completed (F285 → F310). The running theme: autonomous runs should survive agents falling over (token exhaustion, stalls, usage limits) and operators should be able to intervene without losing in-flight work.

### Added
- **`aigon feature-transfer <ID> --to=<agent>`** — hand a stuck in-progress feature from its current agent to a different one without losing commits or in-flight work. Captures pane output → writes a briefing to `docs/specs/features/logs/feature-<ID>-transfer-*.md` → commits uncommitted changes as `wip(transfer): …` → kills old tmux sessions → moves the worktree with `git worktree move` → emits a fresh `feature.started` event → spawns a new tmux session running the receiving agent. Alias `aft`. Primitive that F308's auto-failover detector invokes.
- **Auto failover on token exhaustion** (F308) — supervisor detects Codex/Claude usage-limit and auth-prompt patterns in agent stderr, emits `signal.token_exhausted`, and transitions the feature through `SWITCH_AGENT` guard to the next agent in the configured failover chain (`agentFailover` persisted on `feature.started`). Projector replays `token_exhausted` + `failover_switched` events and clears the exhausted flag so a slot can exhaust again.
- **OpenCode (`op`) as a registry-first agent** (F301) — full registry entry at `templates/agents/op.json`, contract tests, docs at `docs/agents/opencode.md`. Install with `aigon install-agent op`.
- **Close-with-agent flow** (F299) — when `feature-close` hits a blocker (merge conflict, non-fast-forward, pushed-PR mismatch), the dashboard offers a one-click "Open agent session to resolve" that spawns a targeted `feature-close-resolve` session with the blocker context pre-loaded. Removes the "Close Failed" terminal-dead-end.
- **Autonomous stage plan timeline on dashboard cards** (F297) — running/waiting/complete/failed per stage (Implement → Review → Counter-review → Close) rendered inline on every autonomous card, driven from `feature-<ID>-auto.json` state.
- **Rebase-needed warning** (F300) — proactive amber strip + Close button border when the feature branch is behind main. `computeRebaseNeeded` helper, graceful-degradation-tested.
- **Ready-to-close indicator** — green strip when Implement + Review + Counter-review are complete.
- **Per-agent model/effort triplet pickers** (F291) — dashboard agent-picker dropdowns with model + effort overrides per launch; override badges on cards; engine persists `modelOverrides` / `effortOverrides` on `feature.started`; stats aggregate per-triplet cost.
- **Per-turn token telemetry + `workflowRunId`** — activity-scoped stats, Codex config audit, cost rollups.
- **Compact carry-forward in Autopilot iterations 2+** (F289) — each retry gets a deduplicated summary of prior-iteration findings instead of an unbounded transcript.
- **Dashboard review-check status indicators** (F290, F309) — per-review lifecycle status on cards.
- **Auditable agent nudges** — every nudge logs to an append-only trail; nudge dialog on dashboard for targeted prompts.
- **Bootstrap-engine-state-on-create** — `feature-create` / `research-create` now write the workflow snapshot immediately, eliminating the "newly-created renders as legacy" gap.
- **Idle detector + spec pre-authorisation** (F293) — supervisor emits an idle signal when an agent hasn't committed or heartbeated for a configurable window; specs carry `## Pre-authorised` bullets that agents cite in commit footers to proceed past policy gates without stopping for user input.
- **Pre-commit lint hook** + `eslint.config.js` (`no-undef: error`). Would have caught the `ReferenceError: rebaseNeeded is not defined` dashboard crash that actually happened.
- **Dashboard bootstrap crash barrier** — `refreshLatestStatus()` wraps `collectDashboardStatusData()` in try/catch, falls back to a valid-shaped empty response with `collectorError` on failure. Collector bugs now degrade the UI instead of taking down the daemon.
- **Pane capture + `wip(transfer)` commit** ensures no worktree work is lost during an agent swap — validated on #308's real transfer, which preserved 579 insertions across 16 files that had been sitting uncommitted for ~55 minutes.

### Changed
- **Unified `terminalApp` config** (F307) — migration framework folds legacy `terminal` / `tmuxApp` keys into a single canonical `terminalApp`. Idempotent; runs once on config load.
- **`feature-review` → `feature-code-review`** (F298) — reduces collision with spec-review. Legacy aliases retained.
- **`lib/feature-dependencies.js` extracted** from `feature.js` (part of god-object teardown).
- **Test suite under ceiling + regression-anchored** (F310) — suite trimmed and a new rule: raising `CEILING` in `scripts/check-test-budget.sh` requires same-commit test deletion to offset. Error messages explain *why* the budget exists.
- **Research-do submit signal hardened** — clearer Option B for main-branch research agents; reduces "did my review land?" confusion.
- **Cursor agent launched with `--trust`**.

### Fixed
- **Dashboard crash loop on every `/api/status`** — `971ccada` (a `chore: rename feature` commit) swept uncommitted WIP into itself, leaving `rebaseNeeded` referenced but undeclared in the status collector. Two fixes: (1) `feature-rename` / `research-rename` no longer use `git add -A`; (2) per-feature forEach wrapped in try/catch so one broken feature can't kill the daemon. Third layer added this release: pre-commit lint gate so `no-undef` never reaches a commit.
- **Dashboard server startup hardening** (F295) — `formatCliError` now prints stack traces; `listVisibleSpecMatches` filters to numeric-prefixed stage dirs; circular require chain for `lib/utils.js` moved to `Object.assign(module.exports, …)`; Codex autonomous launches use `--dangerously-bypass-approvals-and-sandbox` (prior `--full-auto` prompted for MCP approval and hung indefinitely).
- **`feature-close` stash-pop conflicts now surface** instead of swallowing silently; iTerm AppleScript name fixed.
- **`feature-reset` re-bootstraps engine state** after reset so the spec doesn't render as legacy.
- **Spec drift on close** — `materializePendingEffects` preserves `fromPath` so `move_spec` doesn't lose the source location.
- **Atomic tmux launch** — `bash -lc '…'` instead of create-then-send-keys, closes the F292/F293 byte-interleaved-launch corruption race.
- **Research inbox doctor scan + safe migrate cleanup** (F296).
- **Review prompts patch issues by default** instead of only commenting.
- **Dashboard `/api/sessions/cleanup`** endpoint for the orphan killer; orphaned `aigon-cli.js server start` processes holding test ports now explicitly surfaced (encountered during this release's pre-push validation).
- **Inbox research entries publish slug-as-id** so dashboard actions work on slug-only items.
- **`*-spec-review-record` commands wired up** and reachable from the CLI.

### Removed
- `--full-auto` flag for Codex autonomous launches (replaced — see Fixed).

### Notes
- Two commits landed as hotfixes on this branch: `2ba7124f` (bootstrap guard + pre-commit lint) and `a481e517` (feature-transfer). Both validated against real incidents during development.
- Incident postmortem: the `971ccada` rename-commit sweep pattern recurred once during this release's own development (reproduced while committing feature-transfer; caught, reset, re-staged precisely). The pre-commit lint hook and CLAUDE.md reminder to grep `git diff --cached --name-only` before commit are the current defences.

## [2.52.0] - 2026-04-20

Single-source-of-truth refactor, spec-review workflow, and a hard-fought round of stability fixes. 362 commits since v2.51.3. Subsumes the pending 2.51.5 gitignore change.

### Added
- **Spec-review workflow** (feature 278) — four new commands `feature-spec-review`, `feature-spec-review-check`, `research-spec-review`, `research-spec-review-check` (aliases `afsr`, `afsrc`, `arsr`, `arsrc`). A reviewer agent edits the spec in place against a shared rubric at `templates/generic/prompts/spec-review-rubric.md` and commits with a greppable `spec-review:` prefix; the author runs `-check` to process all pending reviews in one pass and commits `spec-review-check:` as the ack anchor. Invocable from the CLI, per-agent slash commands/skills, and dashboard actions on feature/research cards.
- **Spec drift reconciliation from the dashboard** (feature 275) — drift badge on feature/research cards when the engine-expected folder and the spec file disagree. Per-entity "Reconcile" action moves the file to the engine-expected folder with user consent. `POST /api/spec-reconcile` endpoint, action-registry eligibility, sandbox guard preventing writes outside `docs/specs/`.
- **Autonomous-loop write-path contract** (feature 277) — `capabilities.resolvesSlashCommands` flag on each `templates/agents/*.json` declares whether the agent resolves slash commands natively. AutoConductor's post-review feedback injection uses the flag instead of regex shape-sniffing. cx sessions get a skill-file path pointer instead of a phantom `$aigon-…` command. `isSlashCommandInvocable()` helper in `lib/agent-registry.js`. Contract test pins the invariant for every agent.
- **`buildReviewCheckFeedbackPrompt`** — new helper in `lib/agent-prompt-resolver.js`. Produces the correct post-review-complete instruction per agent (slash command vs skill reference) so the AutoConductor no longer builds the string inline.
- **Stage-filtered visible-spec matching** in `lib/workflow-core/paths.js:listVisibleSpecMatches` — only numeric-prefixed stage directories (`^\d+-/`) are scanned, so `docs/specs/features/logs/feature-N-…-log.md` files don't collide with spec files sharing the same id prefix.
- **Write-Path Contract invariant** in `CLAUDE.md` — "every write path MUST produce an engine action that matches the read-path contract; writes seed engine state, reads derive from it, never the reverse" — with an accompanying entry under "Common Agent Mistakes" naming the hardening-reads-without-auditing-writes anti-pattern that produced three bugs in 24 hours.

### Changed
- **Single-source-of-truth for entity lifecycle** (features 270 / 271 / 272 / 273).
  - **270 — engine-only spec transitions**: all normal-lifecycle commands go through the workflow engine's `move_spec` effect. Normal reads never re-infer state from folder position; missing-snapshot numeric entities fail with explicit migration guidance instead of silent bootstrap. Reset flows (`feature-reset` / `research-reset`) are explicitly out of scope and keep their destructive direct-fs semantics. `entityPrioritise` now creates a workflow snapshot at prioritisation time (the long-silent gap that made newly-prioritised features render as "legacy" on the dashboard).
  - **271 — engine-based read paths**: board and dashboard read lifecycle state from workflow snapshots for numeric entities. Filesystem scanning is retained read-only as a compatibility fallback for no-ID inbox items and legacy numeric entities missing a snapshot — those are surfaced with a `legacy/missing-workflow` compatibility label. `lib/workflow-read-model.js` owns the three-case matrix; `lib/workflow-snapshot-adapter.js` is strictly the raw translation layer beneath it.
  - **272 — self-healing spec reconciliation**: shared `reconcileEntitySpec` helper compares engine state with visible folder position. Default is **detect-only** on dashboard reads (opt-in via `AIGON_AUTO_RECONCILE=1`) — the original always-mutate behaviour thrashed files across every registered repo on every refresh and was rolled back after incidents on brewboard and jvbot. `aigon repair` keeps its broader cleanup behaviour and delegates spec drift to the same helper.
  - **273 — feedback-status authoritative**: feedback entities use frontmatter `status` as the single lifecycle authority. Folder position is a derived projection; feedback commands update metadata first and project to the derived folder afterwards. Manual `git mv` of a feedback file becomes cosmetic drift, not a state mutation.
- **Test suite under budget and regression-comment-enforced** (features 274 + 279). F274 carpet-trimmed the suite from 2998 → 1974 LOC; F279 finished the job after the F270–F277 series drifted it back above ceiling. Final state: **1895 / 2000 LOC** with six named-regression anchors pinned via `// REGRESSION:` comments (F270 `1c2766bc`, F271 `936d2da7` / today's `d015f7d1`, F272 `cbe3aeba`, F277 `b9c39a26`, today's `2047fd10`). `bash scripts/check-test-budget.sh` enforces the ceiling in pre-push.
- **Agent config files are gitignored** (originally planned as 2.51.5) — `.claude/`, `.gemini/`, `.codex/`, `.cursor/`, `.agents/` are generated outputs from `aigon install-agent`. Contributors run `aigon install-agent <agent>` after cloning. Templates in `templates/generic/commands/` are the source of truth.
- **Codex autonomous launches use `--dangerously-bypass-approvals-and-sandbox`** instead of `--full-auto`. `--full-auto` resolves to `-a on-request --sandbox workspace-write` and `on-request` explicitly allows the model to prompt for approval on MCP tool calls (e.g. playwright `browser_navigate`), which halted autonomous cx sessions indefinitely. The bypass flag is codex's documented contract for "skip all confirmation prompts and execute commands without sandboxing" — exactly the contract aigon's autonomous mode needs. Worktrees are externally sandboxed via git worktree isolation + trusted project entries in `~/.codex/config.toml`.
- **Contributor slash commands** live at `templates/contributing/` and install to the root of each agent's command dir (e.g. `.claude/commands/start-docs.md`, `.claude/commands/restart-server.md`) only when CWD contains `aigon-cli.js`. User installs never pick these up.

### Fixed
- **Dashboard server crash loop on startup** — four latent bugs surfaced together and blocked server boot.
  1. `lib/utils.js` used `module.exports = { ... }` inside a circular require chain (`utils → dashboard-server → dashboard-status-collector → feedback → utils`). Switched to `Object.assign(module.exports, { ... })` so feedback.js's reference stays live. F273's runtime reader for `FEEDBACK_STATUS_TO_FOLDER` was the first consumer to trip the latent bug.
  2. `lib/workflow-core/paths.js:listVisibleSpecMatches` treated `docs/specs/features/logs/` as a stage dir, so every feature ever worked on produced a duplicate-match and tripped F276's `unknown-lifecycle` throw at startup. Filtered to numeric-prefixed stage dirs.
  3. `aigon-cli.js:formatCliError` dropped the stack trace. Every diagnosis of crash-loop errors was blind until this was unswallowed. Stack now appended; opt-out via `AIGON_NO_STACK=1`.
  4. `lib/config.js:getAgentLaunchFlagTokens` — the codex autonomous flag fix above.
- **Newly-prioritised features rendered as "legacy"** — `feature-prioritise` / `research-prioritise` never registered the new entity with the workflow engine. After F270 made reads strict about missing snapshots, every new feature became a dashboard orphan with no Start button. `entityPrioritise` now creates the snapshot + bootstrap event immediately after moving the spec file to `02-backlog/`. Idempotent — skips if snapshot already exists.
- **No-ID inbox items lost all actions** (F271 regression) — `createCompatibilityState` hardcoded `validActions: []` for slug-identified inbox items, so newly-created features rendered in the dashboard inbox with no Prioritise button. Pass `entityType` through to the helper and synthesise actions via the shared action-registry matrix. cc/gg/cu/cx all produce the expected `feature-prioritise <slug>` command.
- **Cursor (`cu`) capability flag** incorrectly set to `resolvesSlashCommands: false`. cu's CMD_PREFIX is `/aigon-` — a runnable slash command, not a skill reference. Corrected to `true` so cu reviewers receive the same slash-command invocation cc/gg get. cu is not retired despite an earlier memory note; revalidated 2026-04-20.
- **AutoConductor feedback injection produced an unrunnable phantom command for cx** — `${cmdPrefix}feature-review-check <id>` with `cmdPrefix = "$aigon-"` is a codex skill filename convention, not a command. cx interpreted it as `aigon feature-review-check <id>` and hit "Unknown command", then graceful-degraded by reading the SKILL.md manually. Per-agent capability flag now drives the invocation shape; cx gets a skill-path pointer instead.
- **`Reviewer: unknown` on spec-review commit bodies and dashboard cards** — the dashboard spec-review launcher used `buildRawAgentCommand` which skipped the env-export wrapper the worktree path uses. The template's `${AIGON_AGENT_ID:-unknown}` substitution fell through to the literal string. Launch site now prefixes the raw command with `export AIGON_AGENT_ID=<id>` (plus entity type, id, project path). Future commits correctly name the reviewer; existing `Reviewer: unknown` bodies are git history and unchanged.
- **`AfterAgent` hook fails with "No such file or directory"** — `aigon install-agent` resolved the binary via `which aigon` at install time, which under fnm returns an ephemeral `~/.local/state/fnm_multishells/<id>/bin/aigon` symlink that goes stale when the spawning shell exits. Both hook-install sites in `lib/commands/setup.js` now prefer stable globals (`/opt/homebrew/bin/aigon`, `/usr/local/bin/aigon`) and reject `fnm_multishells` paths when falling back to `which`. Existing stale paths get migrated on the next `install-agent` run via the pre-existing regex rewrite.
- **Docs site search was "Failed to load search index"** in `next dev` — Nextra 4's Pagefind runs only during `next build`. `site/package.json` `build` now mirrors the Vercel build command (runs `pagefind` after `next build`), and a `predev` hook generates the index once if `public/_pagefind` is missing. `site/vercel.json` reuses `npm run build`.
- **`git push --force` and `git reset` safety** — no behaviour change; test-budget script exits non-zero when over ceiling, blocking pre-push. Enforcement now catches silent budget drift that F271/F275/F276/F277 each contributed to.

### Removed
- **`--full-auto` hand-off in autonomous codex launches** — superseded by `--dangerously-bypass-approvals-and-sandbox` per the "Changed" note above.
- **Regex shape-sniffing in AutoConductor** — `lib/commands/feature.js:2860` no longer infers invocation style from `cmdPrefix` shape; the capability flag is authoritative.
- **`.aigon/workflows/specs/<lifecycle>/` junk-dir fallback** as a silent write target — `getSpecStateDirForEntity` throws on unknown lifecycle values; no caller relies on the fallback branch (verified by grep on all 3 registered repos).
- **`default_tools_approval_mode` in `templates/cx/config.toml`** — the key is not read in codex 0.121.0; the real autonomous-approval lever is the CLI flag. Removed to avoid false confidence.

## [2.51.5] - 2026-04-18

### Changed
- **Agent config files are now gitignored** — `.claude/`, `.gemini/`, `.codex/`, `.cursor/`, `.agents/` are generated outputs from `aigon install-agent`. Contributors run `aigon install-agent <agent>` after cloning (see `CONTRIBUTING.md`).

## [2.50.0 – 2.50.43] - 2026-03-18 → 2026-04-07

### Added
- **OSS / Pro repo split** — Pro feature specs, logs, and workflow state moved to a private companion repo. Public aigon now contains only OSS-tier content. Historical Pro features (114, 115, 118, 122, 123, 152, 153, 159, 211, 219, 221, 222, 226) and the corresponding research topics are listed in `docs/specs/features/MOVED-TO-AIGON-PRO.md`.
- **Apache License 2.0** under Sen Labs (replaces the prior MIT-without-LICENSE-file claim).
- **Standard OSS hygiene** — `CONTRIBUTING.md`, `CODE_OF_CONDUCT.md`, `SECURITY.md`, GitHub issue/PR templates, CI workflow (`test.yml`) running the unit suite on Node 18/20/22.
- **Auto-restart server in `feature-close`** when `lib/*.js` files changed during the feature (feature 234) — keeps the dashboard in sync with the new code without manual restart.
- **Stats aggregation** — `aigon stats` rolls up `stats.json` reports across all features, with totals + per-agent + weekly/monthly buckets cached at `.aigon/cache/stats-aggregate.json` (feature 230).
- **Per-agent cost breakdown** in feature stats (feature 231).
- **Honest Pro gate messaging** — gate messages no longer imply a purchase flow exists. Pro is in development and not yet for sale (feature 159).

### Changed
- **`feature-do --autonomous` / `--ralph` renamed to `--iterate`** — old flags print a migration hint and exit 1.
- **`docs/architecture.md` "Aigon Pro" section** trimmed to remove implementation surface (helper API contract details, Pro-side repo structure tree).
- **`site/content/guides/insights.mdx`** (formerly `amplification.mdx`) rewritten to remove the "Setting up Pro" install instructions that referenced the private aigon-pro repo path.

### Removed
- **AADE wording** purged from public-facing docs (`README.md`, `docs/architecture.md`, `site/content/comparisons.mdx`, `site/content/guides/_meta.js`) — feature 232.
- **Dead submit-command doc page** rewritten as a deprecation page pointing at `feature-do` and `aigon agent-status submitted`.
- **Two broken image references** in the Insights guide (`site/content/guides/insights.mdx`).
- **GA4 placeholder tracking** from `site/public/home.html` — relies on Vercel Analytics now.
- **19 root-level dev artifacts** — 16 orphan PNG screenshots, `reproduce_bug.js`, `worktree_link` (broken symlink), and stale `COMPARISONS.md` (the public version at `site/content/comparisons.mdx` is canonical now).

### Fixed
- **Pro availability is global, not project-scoped** (feature 226) — `lib/pro.js` no longer reads project config; the dashboard top nav and subprocesses now agree about Pro state.
- **Site `npm audit fix`** cleared 10 vulnerabilities in the Next.js docs site (9 high, 1 moderate) including picomatch ReDoS, lodash-es, chevrotain, langium.

### Security
- Apache 2.0 includes an explicit patent grant.
- Adopted GitHub Security Advisories as the preferred private disclosure channel (`SECURITY.md`).

## [2.45.0 – 2.49.x] - 2026-03-16 → 2026-03-17

### Added
- **`lib/pro-bridge.js`** — single Pro extension seam (feature 219). Pro is loaded as a subscriber that registers routes via `proBridge.initialize()`; no Pro-specific knowledge in OSS modules.
- **AutoConductor for solo mode** — `feature-autonomous-start --review-agent <agent>` runs implement → review → close unattended (feature 214 + follow-ups).
- **Tiered polling cache** for dashboard status collection — hot/warm/cold data separation, reducing dashboard cost on repos with many features.
- **Server reliability hardening** (feature 220).
- **Inline cx prompt body at launch** instead of `/prompts:` discovery (feature 218) — works around codex 0.117's prompt resolution change.
- **Codex skills migration** — codex install switched to the project-local skills format under `.agents/skills/aigon-*/`.
- **Orphaned session detection, dashboard display, and bulk cleanup**.
- **VS Code extension** — right-click context menu commands in the sidebar.
- **Agent Log tab** in the feature drawer.
- **Feature review check shortcut** — `aigon feature-review-check` for quick review accept/challenge/modify decisions.
- **Standardised tmux session naming** with explicit role prefix (impl/review/eval) so multiple sessions per feature stay distinguishable.

## [2.40.0 – 2.44.x] - 2026-03-13 → 2026-03-15

### Added
- **Repo-scoped tmux session naming convention** — sessions are namespaced by repo, so two repos working on the same feature ID don't collide.
- **Auto-exit tmux session after implementation submission**.
- **Workflow-core engine cutover** — features and research now run on event-sourced state with an XState machine and durable effects.

### Changed
- Engine state is the source of truth for lifecycle transitions; the old `state.json` files are migrated on first read.

## [2.35.0 – 2.39.x] - 2026-03-11 → 2026-03-13

### Added
- **Descriptive tmux window titles** for fast feature/research identification at a glance.
- **Arena conduct command** with per-agent notifications and tests (Fleet research orchestration).
- **Tmux support in `research-open`** — opens all Fleet research agents side-by-side in tmux.
- **Needs Attention section** in the menubar app.
- **Reliability & Safety concepts page** in the docs.
- **Amplification Dashboard guide** in the docs.
- **Telemetry & Analytics guide** in the docs.
- **Screenshot component** with graceful placeholder fallback for missing images.

## [2.30.0 – 2.34.x] - 2026-03-05 → 2026-03-10

### Added
- **`aigon deploy` command** with `deployAfterDone` integration (feature 36) — automatic deploy after a feature reaches done state.
- **Auto-commit on `aigon update`** — keeps update transitions atomic.
- **Multi-agent telemetry normalisation** — common schema for sessions across cc, gg, cx so cross-agent cost reporting works (feature 151).
- **Security scan merge gate** with gitleaks + semgrep, severity thresholds, diff-aware (features 119, 120, 133).

## [2.25.0 – 2.29.x] - 2026-03-02 → 2026-03-04

### Added
- **`/aigon:next` command** — context-aware "what should I do next" suggestions based on current feature/research state. Alias `/an`.
- **Mistral Vibe (`mv`) agent support** — added then later retired (CLI cost structure made it unviable).
- **`aigon doctor` enhancements** — broader environment checks.

## [2.19.0 – 2.24.x] - 2026-02-25 → 2026-03-01

### Added
- **`sessions-close` command** — kills all agent sessions for a feature/research ID and closes the Warp tab.
- **`cli.models` config** — per-task-type model selection (e.g. opus for implement, sonnet for review). Feature 19.
- **Combined project + feature-level validation** in the iterate (Ralph) loop.
- **Findings file open + summary** on arena research completion.
- **Status signal design** — formalised the agent-status signaling model used by the workflow engine.

### Fixed
- Various stability fixes across sessions, telemetry capture, and the dashboard pipeline view.

## [2.18.0] - 2026-02-20

### Added
- **Feedback workflow** — Complete lifecycle for capturing and triaging user/customer input
- `docs/specs/feedback/` with six lifecycle folders (inbox, triaged, actionable, done, wont-fix, duplicate)
- Feedback template with YAML front matter schema (attribution, provenance, severity, tags, links)
- `aigon feedback-create <title>` — Create feedback items with auto-assigned IDs
- `aigon feedback-list` — List and filter feedback by status, type, severity, tags
- `aigon feedback-triage <ID>` — AI-assisted triage with classification, duplicate detection, and status management
- AI duplicate detection using token-based similarity (title + summary)
- Preview-first safety model (requires `--apply --yes` to commit changes)
- Agent prompt templates for feedback-create, feedback-list, feedback-triage
- Feedback commands in all agent configs (cc, gg, cx, cu)
- "The Big Picture: Closing the Loop" section in GUIDE.md explaining research → features → feedback cycle
- Complete product lifecycle documentation with forward/backward traceability

### Changed
- README.md: Added feedback to "Why Aigon" section with full lifecycle explanation
- README.md: Updated directory structure to show research → features → feedback flow
- README.md: Added feedback commands to CLI Reference
- README.md: Updated all agent slash command tables to include feedback commands
- GUIDE.md: Added "Detailed Feedback Lifecycle" section
- GUIDE.md: Added conceptual overview of the three-pillar system (research, features, feedback)
- docs/specs/README.md: Listed feedback as third area alongside research and features

## [2.17.0] - 2026-02-18

### Added
- **Local dev proxy with subdomain routing** — `aigon proxy-setup` installs Caddy + dnsmasq for `*.test` domain routing; `aigon dev-server start` spawns the dev server, allocates a port, registers with the proxy, and waits for a health check
- URL scheme: `http://{agent}-{featureId}.{appId}.test` (e.g., `http://cc-119.whenswell.test`)
- `aigon dev-server` subcommands: `start`, `stop`, `logs`, `list`, `gc`, `url`
- `dev-server start` spawns the process in the background with output captured to `~/.aigon/dev-proxy/logs/`
- `dev-server logs [-f] [-n N]` to view and follow dev server output
- `dev-server stop` kills the process by PID and deregisters from the proxy
- `--register-only` flag for manual process management
- `/aigon:dev-server` slash command template for all agents
- Skill tools (`aigon_dev_server_start`, `aigon_dev_server_stop`, `aigon_dev_server_logs`, `aigon_dev_server_list`) so agents discover dev-server commands from natural language
- Per-project `devProxy` config in `.aigon/config.json` (command, healthCheck, basePort)
- `NEXT_PUBLIC_AIGON_*` env vars in `.env.local` for in-app dev banner support
- Fallback to `localhost:<port>` when proxy is not set up
- README and GUIDE documentation with setup, usage, and troubleshooting

### Changed
- `feature-implement` template updated: agents use `aigon dev-server start` instead of manual PORT management
- Web/API profile `testInstructions` updated to reference `aigon dev-server start`
- `STOP_DEV_SERVER_STEP` includes `aigon dev-server stop`

## [2.16.3] - 2026-02-17

### Fixed
- `STOP_DEV_SERVER_STEP` reads PORT from `.env.local` instead of assuming `$PORT` is set in the shell

## [2.16.2] - 2026-02-17

### Fixed
- Prevent nested Claude Code session error when opening worktrees — prepend `unset CLAUDECODE &&` to agent launch commands
- `AGENT_DEV_SERVER_NOTE` placeholder for Codex PTY/background process warning
- Clearer dev server instructions in worktree test steps (removed confusing `PORT=<port>` literal)

## [2.16.1] - 2026-02-16

### Added
- `feature-now` detects inbox features and fast-tracks them (prioritise + setup + implement)
- Kanban board example in README opening section

### Changed
- README and GUIDE updated for config refactor and port configuration

## [2.16.0] - 2026-02-16

### Added
- **Base port configuration** — reads PORT from `.env.local` or `.env` and derives arena agent ports as PORT+1 (cc), PORT+2 (gg), PORT+3 (cx), PORT+4 (cu)
- `readBasePort()` helper to parse PORT from env files (checks `.env.local` first, then `.env`)
- `showPortSummary()` displays port configuration during `init`, `update`, `install-agent`, and `profile show`
- Warning during `feature-setup` when no PORT found for web/api profiles
- Port label echo in arena split panes (`🔌 Claude — Port 3401`) so each pane shows its port on launch

### Changed
- Arena split panes now sort by port offset order (cc, gg, cx, cu) instead of alphabetically
- Ports are always derived from `.env` PORT — removed `arena.ports` config override support

## [2.9.0] - 2026-02-07

### Added
- **Project profile system** for non-web project support (`aigon profile`)
- Six profiles: `web`, `api`, `ios`, `android`, `library`, `generic`
- Auto-detection from project files (Xcode, Gradle, Next.js, Cargo.toml, etc.)
- Checks `ios/` and `android/` subdirectories for mobile projects
- Explicit override via `.aigon/config.json` (`aigon profile set <type>`)
- Profile-aware arena mode: dev server, ports, `.env.local`, and template content adapt to project type
- `aigon profile show` — display current profile and settings
- `aigon profile set <type>` — set project profile explicitly
- `aigon profile detect` — show what auto-detection would choose
- Project profile summary in `aigon config show`

### Changed
- Templates use `{{PLACEHOLDER}}` values for test instructions, dependency checks, and `.env.local` setup
- `feature-setup` only creates `.env.local` with PORT when dev server is enabled (web/api profiles)
- `processTemplate()` uses callback replacement to prevent `$` back-reference issues in multi-line values

## [2.8.0] - 2026-02-06

### Added
- Prompt suggestion hints to all workflow command templates
- Each command now guides Claude Code's grey text suggestion to the next workflow step
- Covers the full chain: create → prioritise → setup → implement → eval/review → done → cleanup

## [2.4.1] - 2026-02-02

### Added
- `feature-now` command — fast-track a feature from idea to implementation in one step (create + prioritise + setup, solo branch)
- `feature-now` slash command template for guided spec writing and implementation
- `feature-now` to all agent configs (cc, gg, cx, cu)
- `pre-feature-now` / `post-feature-now` hook support
- `feature-now` documentation in README (workflow, CLI reference, agent macros, hooks)

## [2.4.0] - 2026-02-02

### Added
- `feature-list` command to show features by status, mode, and location
- Solo worktree mode — `feature-setup <ID> <agent>` creates an isolated worktree for parallel development of multiple features
- Argument resolution to slash command templates — agents can now resolve partial or missing IDs interactively
- Worktree reorganization — worktrees grouped under `../<repo>-worktrees/` directory
- `feature-done` auto-detects solo worktree agent

### Changed
- Slash command templates updated with codebase exploration before spec writing
- Agents instructed to create tasks from acceptance criteria during implementation
- README updated with solo worktree mode, feature-list, and worktree reorganization docs

## [2.3.0] - 2026-01-30

### Added
- Automatic cleanup of deprecated slash commands during `install-agent` and `update`
- Scans each agent's command directory for stale aigon-managed files and removes them
- Reports removed commands with a cleanup message

## [2.2.1] - 2026-01-29

### Fixed
- Use native slash command syntax in next-step recommendations

## [2.2.0] - 2026-01-28

### Added
- Cursor agent support (`cu`) with `.cursor/commands/` integration

## [2.1.0] - 2026-01-27

### Added
- Arena mode for research topics - multiple agents can research in parallel
- `research-setup` command for setting up solo or arena research
- `research-conduct` command for agents to write findings
- `research-synthesize` command for comparing agent findings in arena mode
- Interactive feature selection with deduplication in `research-done`
- Findings file template for arena mode research

### Changed
- Research workflow now mirrors feature workflow pattern (setup → conduct → done)
- `research-done` auto-detects arena mode and shows findings summary

### Removed
- `research-start` command (replaced by `research-setup` and `research-conduct`)

## [2.0.0] - 2025-12-17

### Added
- Unified workflow commands for solo and arena modes
- Arena mode terminology (renamed from "bakeoff")

### Changed
- **Breaking:** Renamed bakeoff commands to arena commands:
  - `bakeoff-setup` → `feature-setup <ID> <agents...>`
  - `bakeoff-implement` → `feature-implement <ID>`
  - `bakeoff-cleanup` → `feature-cleanup <ID>`
- `feature-setup` now handles both solo (no agents) and arena (with agents) modes
- `feature-implement` auto-detects mode based on current directory
- Arena log files now created in worktrees instead of main repo

### Removed
- Separate bakeoff commands (unified into feature commands)

## [1.3.1] - 2025-12-16

### Fixed
- Evaluator now correctly points to worktree logs instead of main repo
- Removed unused `_aigon` cleanup code

## [1.3.0] - 2025-12-16

### Added
- Hooks system for custom pre/post command scripts
- `aigon hooks list` command to show defined hooks
- Hook documentation in README
- Support for `docs/aigon-hooks.md` configuration file

## [1.2.1] - 2025-12-15

### Fixed
- Various bug fixes and improvements

## [1.2.0] - 2025-12-10

### Added
- Initial bakeoff mode for multi-agent competitions
- Worktree-based isolation for parallel implementations

## [1.1.1] - 2025-12-09

### Fixed
- Minor bug fixes

## [1.1.0] - 2025-12-09

### Added
- Agent configuration system
- Support for Claude, Gemini, and Codex agents
- `install-agent` command

## [1.0.0] - 2025-11-24

> **Note:** No git tag was cut for v1.0.0 — it's the conceptual initial release marker. The first actual tag is `v1.1.0` on 2025-12-09. The first commit (`5d73102a`) is dated 2025-11-24.

### Added
- Initial release
- Feature lifecycle management (create, prioritise, implement, eval, done)
- Research lifecycle management (create, prioritise, start, done)
- Spec-driven development workflow
- State-as-folders architecture
