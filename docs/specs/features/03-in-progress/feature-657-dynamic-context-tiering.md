---
complexity: medium
depends_on: []
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-09T01:09:29.618Z", actor: "cli/feature-prioritise" }
---

# Feature: slim-aigon-root-agent-context

## Summary

Reduce cold-start context cost for agents working on **the Aigon repository itself** by shrinking the repo-owned root `AGENTS.md` into a concise always-loaded instruction file and moving deep reference material to existing on-demand docs. Add a static size/required-invariant guard so the file cannot silently grow back into a 15–20k-token prefix.

Do **not** implement dynamic context tiers, marker extraction, task-aware context assembly, generated prompt files, or an OpenCode `agent.build.prompt` override in this feature. OpenCode loads the project-root `AGENTS.md` as a separate system-instruction source and combines it with configured instructions; a custom build-agent prompt is additive and therefore does not suppress the large root file.

## Background

- This repo's `AGENTS.md` is 439 lines / 75,573 bytes (roughly 15–20k tokens before harness prompts and tool schemas). Real Aigon-managed OpenCode sessions start in the repo/worktree and load it on turn 1 — local telemetry shows first assistant turns of ~30–37k input tokens. The probe-cost fixes in commit `95e233cbe` are complementary and already shipped; they did not address real sessions.
- The F420 install contract makes consumer `AGENTS.md` files user-owned: `install-agent` neither creates nor modifies them. The oversized root file is therefore an **Aigon-repo maintenance problem**, not a template leak into target repos.
- Why the original dynamic-tiering design was dropped: OpenCode includes project `AGENTS.md` as a separate system-instruction source and combines configured `instructions` with it — an `agent.build.prompt` override is additive and does not suppress the root file. Additionally, `AIGON_TASK_TYPE` is not exported to the session env (it is scoped to the `aigon agent-status` start command), so task-aware assembly would have required new plumbing on top of a mechanism that could not deliver the reduction.
- A separate target-repo instruction leak (stack-specific placeholder text in `templates/agents/cx.json` / `cu.json` rendered into consumer docs, unscanned by `scripts/check-template-leaks.js`) was found during spec review and is tracked as its own feature — see Related.

## User Stories

- As an operator paying OpenRouter per token, I want OpenCode sessions in the Aigon repo to avoid loading a 75 KB maintainer reference before useful work begins.
- As an Aigon maintainer, I want the load-bearing safety and workflow invariants available at session start, with module/state detail linked for on-demand reading.
- As a maintainer, I want a mechanical budget and required-anchor check so routine documentation updates cannot recreate the oversized root file.
- As a user of Aigon in another repo, I want this change to leave my root instructions and Aigon-installed instruction contract unchanged.

## Acceptance Criteria

### Static root-instruction slim-down

- [ ] Reduce this repo's root `AGENTS.md` to **at most 24 KB and 180 lines**.
- [ ] Keep the session-start file focused on invariants that can prevent destructive or invalid work: OSS/Pro boundary, target-repo zero-opinion boundary, template source-of-truth, feature/spec lifecycle authority, `ctx` pattern, dashboard gallery guardrail, server restart after `lib/*.js` edits, test/commit/version expectations, and reading-order pointers.
- [ ] Move or consolidate detailed module maps, state-by-state histories, install internals, and long testing explanations into `docs/architecture.md`, `docs/testing.md`, or another existing repo-owned reference. Avoid duplicating the same detail in both root and reference docs.
- [ ] The root file points agents to the relevant deep references and explicitly says to read them on demand when the task touches that area.
- [ ] No file under `templates/` gains Aigon-repo module paths or maintainer-only rules as part of this work.

### Regression guard

- [ ] Add `scripts/check-root-instruction-budget.js` (or equivalently named focused guard) that fails when `AGENTS.md` exceeds either budget.
- [ ] The guard also fails if required safety anchors disappear. Match stable marker comments or stable section identifiers rather than brittle prose snapshots.
- [ ] Wire the guard into `test:core` and `prepublishOnly` alongside the existing template/module guards.
- [ ] Unit coverage proves over-budget files and missing required anchors fail with actionable messages.

### Measurement

- [ ] Record before/after `AGENTS.md` lines and bytes in the implementation log.
- [ ] Record a comparable before/after first-assistant-turn input-token observation for one Aigon-managed OpenCode session when a paid test can be run safely. Use the same OpenCode version, model, and task shape where practical.
- [ ] Target at least a **65% byte reduction** in `AGENTS.md`; treat token reduction as an observed outcome rather than assuming every byte maps directly to a billable token because the harness prompt and tool schemas remain.
- [ ] If a paid after-measurement is deliberately skipped, document why and retain the deterministic byte-budget evidence; do not launch a multi-model probe sweep for measurement.

### Boundary and non-regression

- [ ] `lib/commands/setup/project-context.js` behavior and `--json` output remain unchanged.
- [ ] `install-agent` still leaves consumer `AGENTS.md`, `CLAUDE.md`, and `README.md` byte-identical or absent.
- [ ] OpenCode launch commands do not set a custom `agent.build.prompt`, generate context files, or introduce a new context-tier config schema.
- [ ] Existing target-template leak checks remain green; the separately identified rendered-placeholder gap is documented as follow-up work rather than silently folded into this feature.

## Validation

```bash
node scripts/check-root-instruction-budget.js
node scripts/check-template-leaks.js
node tests/integration/install-agent.test.js
npm run test:core
```

Post-implementation manual measurement (one session, not a probe sweep):

```bash
# Run one Aigon-managed OpenCode task, then inspect the first assistant turn's
# tokens.input in ~/.local/share/opencode/opencode.db or Aigon telemetry.
```

## Technical Approach

### Design principle

Keep the harness-native always-loaded file small. Put durable detail in normal repo docs and let the agent read the relevant reference only when the task needs it.

### Documentation split

1. Inventory every root `AGENTS.md` section as `always required`, `task-specific reference`, or `duplicate`.
2. Retain concise, high-consequence invariants and reading pointers in the root file.
3. Move missing deep detail to the existing authoritative reference (`docs/architecture.md` or `docs/testing.md`); delete duplicate copies when the reference already contains it.
4. Add stable HTML marker comments around the required root invariants for the budget guard. The markers are for static verification only, not runtime extraction.

### Why not dynamic tiering

- Aigon does not own consumer root instruction files, so a generic marker/tier format would create a second opt-in authoring contract with little benefit for most repos.
- The existing `project-context` pointer is already small and appropriate for hook-based agents.
- OpenCode's project instruction loader is harness-owned. Adding an Aigon build-agent prompt does not prevent it from loading root `AGENTS.md`.
- Task-to-tier mapping would duplicate information already carried by canonical feature/research prompt bodies and make precedence/debugging harder.
- Static files preserve normal harness caching and are inspectable without reconstructing launch-time state.

## Dependencies

- None. Probe-cost mitigation commit `95e233cbe` is complementary and already shipped.

## Out of Scope

- `project-context --tier`, `--agent`, or `--task` options.
- `AIGON_CONTEXT` extraction or nested marker parsing.
- `.aigon/config.json` `context.tiers` schema.
- `.aigon/generated/context-*` files.
- `OPENCODE_CONFIG_CONTENT` changes for build prompts or title-agent behavior.
- Rewriting or suppressing a target repo's user-owned `AGENTS.md`.
- Fixing the cx/cu rendered-placeholder leak found during review; track it as a separate target-template guard feature.
- RAG, automatic git-diff context selection, or dynamic spec summaries.

## Related

- Probe-cost mitigation: commit `95e233cbe`.
- Consumer root-file ownership: F420 (`stop-scaffolding-consumer-agents-md`).
- Existing pointer primitive: `lib/commands/setup/project-context.js`, `templates/generic/agents-md.md`.
- Prior research: R35 (`token-and-context-reduction`).
- Current OpenCode rule behavior: project `AGENTS.md` is a system instruction source; configured instruction files are combined with it.
- Follow-up feature: `rendered-agent-template-zero-opinion-guard` — fixes the cx/cu placeholder leak and extends leak checking to rendered install artifacts (created from this spec review; product correctness, separate from this repo-maintenance feature).
