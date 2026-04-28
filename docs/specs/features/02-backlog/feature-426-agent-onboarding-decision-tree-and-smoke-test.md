---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:36:59.826Z", actor: "cli/feature-prioritise" }
---

# Feature: agent-onboarding-decision-tree-and-template

## Summary

Provide a repeatable, structured process for adding new agents to aigon. As the platform scales toward 10–20 agents, there is no decision tree for classifying a new agent's launch type and no guided template for producing a correct `templates/agents/<id>.json`. If the decision tree is followed and the JSON is filled in correctly, the agent works — the launch path is already battle-tested. This feature delivers the decision tree and template without touching `aigon/AGENTS.md` (reserved for the `aigon-install-contract` set's doc-reorg feature).

## User Stories

- [ ] As an aigon maintainer adding a new agent, I want a decision tree that tells me exactly which fields to set in `templates/agents/<id>.json` based on 5 classification questions, so I don't have to reverse-engineer the codebase to get it right.
- [ ] As an agent implementing a new agent feature, I want a spec template that walks me through every required field and produces a checklist of test assertions to add, so nothing is forgotten.
- [ ] As a maintainer validating a newly-configured agent, I want a tiny brewboard feature (feature 01) that I can start with any agent and that proves the full production path — visible tmux output, correct implementation-complete signal, session stays alive — in under 60 seconds.

## Acceptance Criteria

### docs/adding-agents.md
- [ ] File exists at `docs/adding-agents.md` with the 5-question decision tree (Q1: prompt delivery, Q2: slash-command support, Q3: --model flag, Q4: interactive vs batch, Q5: transcript telemetry).
- [ ] Includes the launch-type reference table mapping each type (Slash-command, File-prompt, TUI-inject) to its agents, prompt delivery mechanism, and session behaviour.
- [ ] Includes a "Key files" section pointing to `templates/agents/`, `lib/agent-registry.js`, `lib/worktree.js`, `lib/config.js`, and `tests/integration/worktree-state-reconcile.test.js`.
- [ ] Does **not** appear in `aigon/AGENTS.md` — the `aigon-repo-internal-doc-reorg` feature (inbox, `aigon-install-contract` set) will add the catalog entry to `docs/README.md` when it lands.

### templates/feature-template-agent-onboard.md
- [ ] File exists at `templates/feature-template-agent-onboard.md`.
- [ ] Contains sections for: Agent Identity, Decision Tree Answers (Q1–Q5 filled in), `templates/agents/<id>.json` field checklist (every field annotated with which Q-answer drives it), `docs/agents/<id>.md` checklist, test contract (assertion block to add to `worktree-state-reconcile.test.js`), and Validation step.

### docs/development_workflow.md
- [ ] Contains a one-line pointer to `docs/adding-agents.md` added under a natural heading. File is not otherwise restructured.


## Validation

```bash
# Verify new docs exist in the aigon repo
test -f docs/adding-agents.md
test -f templates/feature-template-agent-onboard.md
grep -q "adding-agents" docs/development_workflow.md
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.
- May run `aigon seed-reset brewboard --force` to validate the brewboard smoke test end-to-end.

## Technical Approach

**`docs/adding-agents.md`** — standalone markdown, no code changes. Decision tree as a Q&A block, launch-type table, key-files reference pointing to `templates/agents/`, `lib/agent-registry.js`, `lib/worktree.js`, `lib/config.js`, and `tests/integration/worktree-state-reconcile.test.js`.

**`templates/feature-template-agent-onboard.md`** — a spec template with pre-filled headings and inline instructions as HTML comments. The `templates/agents/<id>.json` field checklist mirrors the actual JSON structure and labels each field with its Q-answer derivation so the implementer can fill it top-to-bottom without guessing.

**`docs/development_workflow.md`** — add one line under the nearest "Agents" or "Adding agents" context pointing to `docs/adding-agents.md`. Do not restructure.

**Brewboard seed changes** — work in the `brewboard-seed` repo:
- Add `docs/specs/features/02-backlog/feature-01-format-date.md` with a minimal spec: one function, one file, no dependencies, `aigon agent-status implementation-complete` as the final step.
- Add the validation prompt to `AGENTS.md` under the existing "Getting started" or "Commands" section.
- Run `aigon seed-reset brewboard --force` to pick up the changes and validate all three launch types (cc, cu, op).

No `lib/` code changes required. No `aigon/AGENTS.md` changes.

## Dependencies

- `aigon-repo-internal-doc-reorg` (inbox, `aigon-install-contract` set) — will add `docs/adding-agents.md` to `docs/README.md` when it lands. This feature is independent and can land first.

## Out of Scope

- Any runtime validation or test harness — following the decision tree correctly is sufficient; the first real feature run validates the agent.
- Changes to `lib/agent-registry.js` or `lib/worktree.js` — this feature only documents them.
- Modifications to `aigon/AGENTS.md` — reserved for `aigon-repo-internal-doc-reorg`.
- Adding `worktree-state-reconcile.test.js` assertions for a specific new agent — that belongs in each individual agent-onboarding feature, guided by the template produced here.

## Related

- `aigon-repo-internal-doc-reorg` (inbox, `aigon-install-contract` set) — will add `docs/adding-agents.md` to the `docs/README.md` catalog when it lands
- Direct motivation: cursor agent `implementFlag` misconfiguration, 2026-04-28
