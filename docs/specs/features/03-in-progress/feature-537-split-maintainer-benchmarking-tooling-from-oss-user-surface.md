---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-27T04:23:44.421Z", actor: "cli/feature-prioritise" }
---

# Feature: split maintainer benchmarking tooling from OSS user surface

## Summary

Move Aigon's model benchmarking, model discovery, model-refresh, and contributor-only matrix maintenance tooling out of the open-source end-user CLI surface and into Aigon Pro/internal maintainer tooling. OSS Aigon should keep the read-only user value: curated agent/model metadata, model picker options, model override/configuration, qualitative scores, notes, pricing, quarantine state, and dashboard Agent Capability Matrix. OSS Aigon should not ask ordinary users to understand or run benchmark sweeps, model catalog refreshes, pending model queues, eval qualification harnesses, or raw `.aigon/benchmarks` artifact generation.

This feature is release-cleanup work before the next npm cut. The goal is a smaller, calmer public CLI: end users see the commands they use to manage specs, agents, repos, sessions, and the dashboard; maintainer activities for deciding which models belong in the curated registry move behind Pro/internal boundaries.

## User Stories

- [ ] As an Aigon end user, I can open Settings and see agent/model information, scores, pricing, notes, refreshed dates, and quarantine warnings without seeing commands for contributing benchmark data.
- [ ] As an Aigon end user, I can still override or configure models for each agent through the existing settings/model picker flows.
- [ ] As an Aigon end user, `aigon help` and installed slash commands show only normal product workflow commands, not maintainer benchmark/model-refresh commands.
- [ ] As the maintainer, I can still run model qualification, benchmark sweeps, raw benchmark result generation, and registry refresh in `aigon-pro` or another internal maintainer surface.
- [ ] As the maintainer, I can publish curated model registry updates back into OSS `templates/agents/*.json` without shipping the machinery that generated them.

## Acceptance Criteria

- [ ] OSS `aigon help` no longer lists maintainer-only model qualification commands:
  - `aigon perf-bench`
  - `aigon eval` (the aigon-eval/model-qualification harness only; do not touch `feature-eval` or `research-eval`)
  - `aigon model-refresh`
  - `aigon bench-refresh`
  - `aigon matrix-apply`
  - `aigon agent-quarantine` (registry mutation; see Open Questions for user-side emergency hiding)
  - `aigon agent-probe --include-bench` (benchmark-specific probe flags; keep `--quota` if it serves user diagnostics)
- [ ] Normal lifecycle evaluation remains intact:
  - `aigon feature-eval`
  - `aigon research-eval`
  - dashboard evaluation/review flows
- [ ] The dashboard Agent Capability Matrix remains visible in OSS and still reads curated metadata from `templates/agents/*.json` via `/api/agent-matrix`.
- [ ] The model picker/default configuration surfaces remain visible in OSS, including:
  - `cli.modelOptions`
  - `cli.effortOptions`
  - `cli.complexityDefaults`
  - global/project model overrides
- [ ] Curated model metadata remains in OSS agent JSON files:
  - `score`
  - `notes`
  - `pricing`
  - `lastRefreshAt`
  - `quarantined`
- [ ] Raw benchmark generation and refresh code is removed from OSS command dispatch and help surfaces. No Pro-delegating stubs — commands become unknown (see resolved Open Question).
- [ ] Benchmark/eval runner implementation files are removed from the OSS npm package unless they are still required for read-only matrix display:
  - candidate removal/move targets: `lib/perf-bench.js`, `lib/commands/bench.js`, `lib/commands/aigon-eval.js`, `lib/aigon-eval-runner.js`, `lib/aigon-eval-checks.js`, `lib/benchmark-judge.js`, `lib/matrix-apply.js`, and `templates/aigon-eval/**`.
  - keep read-only files needed by OSS UI: `lib/agent-matrix.js` and curated `templates/agents/*.json`.
- [ ] `templates/generic/commands/model-refresh.md` is removed (this is a slash-command template that installs into user repos via `install-agent`).
- [ ] OSS docs no longer tell ordinary users to run benchmark/model-refresh commands.
- [ ] Pro/internal docs or code receives enough implementation notes to recreate the moved command surface later. If the actual Pro move is out of scope for this feature, the OSS removal must clearly document where the code was removed from and what Pro needs to own.
- [ ] Untracked/generated `.aigon/benchmarks/*.json` files are not committed as part of this feature unless a deliberately curated static fixture is introduced for read-only display.
- [ ] Existing public docs that mention benchmark panels describe them as read-only/provided data or Pro-owned functionality, not as user-run OSS workflows.
- [ ] Tests are updated so OSS no longer expects removed maintainer commands/templates.

## Validation

```bash
node -c aigon-cli.js
npm test
node -e "const m=require('./lib/agent-matrix'); const rows=m.buildMatrix(); if (!rows.length) throw new Error('agent matrix empty'); console.log(rows.length)"
! node aigon-cli.js help | grep -E "perf-bench|model-refresh|bench-refresh|aigon-eval|matrix-apply|agent-quarantine"
node aigon-cli.js help | grep "feature-eval"
node aigon-cli.js help | grep "research-eval"
test ! -f templates/generic/commands/model-refresh.md
test ! -f lib/commands/bench.js
test ! -f lib/commands/aigon-eval.js
```

If the implementation removes tests or code paths that are currently part of `npm test`, update the validation command list before closing. The final validation must prove both halves of the split: maintainer commands are gone from OSS user surfaces, and read-only model intelligence still renders/serves.

## Technical Approach

### 1. Define the boundary

Keep in OSS:

- Curated model registry data in `templates/agents/*.json`.
- Model configuration and override UX.
- `/api/agent-matrix` and dashboard Agent Capability Matrix.
- Recommendation logic that reads curated scores and local telemetry aggregates.
- Quarantine metadata as read-only information in the matrix and pickers.
- Core lifecycle eval commands: `feature-eval` and `research-eval`.

Move to Pro/internal:

- `perf-bench` command and implementation.
- `aigon eval` model-qualification harness and fixtures.
- `model-refresh` / `bench-refresh` provider discovery.
- Pending model queue machinery.
- Benchmark judge implementation.
- Raw `.aigon/benchmarks` artifact generation and monthly benchmark recurring template.
- `lib/matrix-apply.js` and the `matrix-apply` command — exists only to apply maintainer feedback to agent registry JSON.
- `agent-quarantine` command (pending open question resolution).
- `agent-probe --include-bench` flag (keep `agent-probe --quota` for user diagnostics).

### 2. Remove maintainer commands from public dispatch

Audit and remove from these command registration sites:

1. **`aigon-cli.js`** — lazy-require of `createAigonEvalCommands` (line ~63). Remove the require and its command registrations.
2. **`lib/commands/bench.js`** — exports `perf-bench`, `bench-refresh`, `model-refresh`. Remove the entire file.
3. **`lib/commands/aigon-eval.js`** — exports `aigon eval` model-qualification harness. Remove the entire file.
4. **`lib/commands/misc.js`** — the `names` array (line ~1997) registers `perf-bench`, `matrix-apply`, `agent-probe`, `agent-quarantine`. Remove those entries. Also remove `matrix-apply` and `agent-quarantine` command implementations from this file.
5. **`templates/help.txt`** — line ~135 mentions `aigon-eval`. Remove that line.
6. **`templates/generic/commands/model-refresh.md`** — installed slash-command template. Remove the file.
7. **`lib/templates.js` `COMMAND_REGISTRY`** — check for any bench/eval entries and remove.

Complete removal, no Pro stubs — commands become unknown in OSS.

**Name collision guard** — be careful with names:

- Remove only `aigon eval` from `lib/commands/aigon-eval.js`. The word "eval" also appears in `feature-eval` and `research-eval` — those are lifecycle evaluation commands in `lib/commands/feature.js` and `lib/commands/research.js` and must not be touched.
- Do not remove general dashboard evaluation/review flows.

### 3. Preserve read-only model intelligence

Verify these paths still work after the removal:

- `lib/agent-registry.js:getModelOptions`
- `lib/agent-registry.js:getDashboardAgents`
- `lib/agent-matrix.js`
- `lib/dashboard-routes/config.js` `/api/agent-matrix`
- `templates/dashboard/js/settings.js` Agent Capability Matrix
- `lib/spec-recommendation.js`
- `lib/telemetry.js` pricing lookup from `cli.modelOptions`

Do not strip `score`, `notes`, `pricing`, `lastRefreshAt`, or `quarantined` from `templates/agents/*.json`. These are the user-facing read-only value.

### 4. Decide what to do with benchmark read paths

The Pro benchmark panel is already gated:

- dashboard `/api/benchmarks*` returns a Pro-required payload when Pro is absent.
- `/js/benchmark-matrix.js` is served from `@aigon/pro` when available.

For this feature, OSS keeps the Pro placeholder. Remove OSS implementation paths that generate or mutate benchmark data.

`lib/bench-hydrate.js` is consumed by two OSS callers:
- `lib/dashboard-routes/analytics.js` — `mergeBenchVerdictsIntoQuota` for the `/api/quota` response.
- `lib/commands/misc.js` `agent-probe --include-bench` — hydrates bench verdicts into probe output.

Decision: keep `lib/bench-hydrate.js` as a read-only hydration helper (it reads `.aigon/benchmarks/*.json` but does not generate them). Remove the `--include-bench` flag from `agent-probe` as part of the command cleanup; the analytics route may still call it if Pro-generated benchmark files happen to be present.

### 5. Update docs and templates

Remove ordinary-user references to benchmark/model-refresh workflows from:

- `templates/help.txt`
- installed slash command registry/templates
- public site command references
- recurring benchmark templates if they live in OSS
- docs that present benchmark refresh as normal OSS usage

Keep or rewrite docs that explain the Agent Capability Matrix as read-only curated information.

### 6. Execution order

1. Remove command registrations (step 2) — unblocks everything else.
2. Delete implementation files (`lib/perf-bench.js`, `lib/commands/bench.js`, `lib/commands/aigon-eval.js`, `lib/aigon-eval-runner.js`, `lib/aigon-eval-checks.js`, `lib/benchmark-judge.js`, `lib/matrix-apply.js`).
3. Remove `templates/generic/commands/model-refresh.md` and `templates/aigon-eval/` directory.
4. Update `templates/help.txt` and any site docs.
5. Fix broken tests — update or remove tests that exercise deleted commands/files.
6. Run full validation script.

### 7. Keep generated state out of the release

Do not commit local `.aigon/benchmarks/*.json` outputs. If a future static curated benchmark dataset is desired for OSS display, introduce a deliberate, small, documented file with stable schema instead of committing raw run artifacts.

## Dependencies

- Aigon Pro/internal repo is the target home for moved maintainer tooling, but this OSS feature may complete with clear removal boundaries and TODO notes if the Pro migration happens in a follow-up private change.
- Existing dashboard Agent Capability Matrix must remain functional before any release is cut.

## Out of Scope

- Removing or weakening model override/configuration for end users.
- Removing curated model metadata from `templates/agents/*.json`.
- Removing `feature-eval` or `research-eval`.
- Building a new Pro benchmark UI.
- Publishing or validating a new static benchmark dataset.
- Changing workflow engine states.
- Reworking the pricing/telemetry model except where required to keep read-only model metadata visible.

## Open Questions

- **[RESOLVED — remove]** ~~Should OSS keep a hidden Pro-delegating stub for removed commands?~~ No. Commands become unknown in OSS. Stubs add maintenance surface for no user benefit.
- **[RESOLVED — keep probe, strip bench flag]** ~~Should `agent-probe --quota` remain?~~ Yes. `agent-probe --quota` is user-facing diagnostics. Remove `--include-bench` flag only.
- **Needs decision:** Should `agent-quarantine` remain available for emergency user-side hiding of broken models, or should all registry mutation become maintainer-only? (Current spec treats it as removed — reverse if user needs emergency model hiding without maintainer access.)
- **[RESOLVED — remove]** ~~Should `matrix-apply` move entirely to Pro/internal?~~ Yes. `matrix-apply` exists only to apply maintainer benchmark feedback to agent JSON; remove from OSS.
- **Needs decision:** Should the public docs mention that model scores are curated by maintainers, or simply present them as product metadata? (Recommendation: present as product metadata — avoids implying users should contribute.)

## Related

- Current OSS read-only matrix path: `lib/agent-matrix.js`, `/api/agent-matrix`, `templates/dashboard/js/settings.js`.
- Current Pro benchmark UI hook: `/js/benchmark-matrix.js`, `/api/benchmarks*`.
- Current maintainer command code: `lib/perf-bench.js`, `lib/commands/bench.js`, `lib/commands/aigon-eval.js`.
- Prior benchmark features: F360, F371, F438, F441, F442, F447, F456, F462, F503, F504.
