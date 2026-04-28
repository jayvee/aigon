---
complexity: medium
---

# Feature: agent-onboarding-decision-tree-and-smoke-test

## Summary

Provide a repeatable, structured process for adding new agents to aigon. As the platform scales toward 10–20 agents, there is no decision tree for classifying a new agent's launch type, no guided template for producing a correct `templates/agents/<id>.json`, and no real-agent smoke test. This feature delivers all three without touching `aigon/AGENTS.md` (reserved for the `aigon-install-contract` set's doc-reorg feature).

## User Stories

- [ ] As an aigon maintainer adding a new agent, I want a decision tree that tells me exactly which fields to set in `templates/agents/<id>.json` based on 5 classification questions, so I don't have to reverse-engineer the codebase to get it right.
- [ ] As an agent implementing a new agent feature, I want a spec template that walks me through every required field and produces a checklist of test assertions to add, so nothing is forgotten.
- [ ] As a maintainer validating a newly-configured agent, I want a tiny brewboard feature (feature 01) that I can start with any agent and that proves the full production path — visible tmux output, correct implementation-complete signal, session stays alive — in under 60 seconds.

## Acceptance Criteria

- [ ] `docs/adding-agents.md` exists with the 5-question decision tree, the launch-type reference table (Slash-command / File-prompt / TUI-inject), and pointers to the key files in `lib/`.
- [ ] `templates/feature-template-agent-onboard.md` exists and covers: Agent Identity, Decision Tree Answers (Q1–Q5), `templates/agents/<id>.json` field checklist, `docs/agents/<id>.md` checklist, test contract (which assertion block to add to `worktree-state-reconcile.test.js`), and Validation step.
- [ ] `docs/development_workflow.md` contains a one-line pointer to `docs/adding-agents.md` (added under a natural heading — do not restructure the file).
- [ ] `brewboard-seed` has `docs/specs/features/02-backlog/feature-01-format-date.md` — a tiny, self-contained spec asking for a `formatDate(date: Date): string` utility in `src/lib/format-date.ts`.
- [ ] `brewboard-seed`'s `AGENTS.md` includes a post-install validation prompt: *"Validate your agent: `aigon feature-start 01 <agent-id>` — should complete in ~60s, signal implementation-complete, and leave the session interactive."*
- [ ] Running `aigon feature-start 01 cu` on a freshly reset brewboard produces: (a) visible human-readable output in the tmux pane, (b) `status: implementation-complete` in `.aigon/state/feature-01-cu.json`, (c) `signal.agent_ready` in `events.jsonl`, (d) tmux session still alive (`tmux has-session`).
- [ ] `docs/adding-agents.md` is **not** referenced from `aigon/AGENTS.md` directly — `aigon-repo-internal-doc-reorg` (inbox, `aigon-install-contract` set) will add the catalog entry in `docs/README.md` when it lands.

## Validation

```bash
# Verify new docs exist
test -f docs/adding-agents.md
test -f templates/feature-template-agent-onboard.md
grep -q "adding-agents" docs/development_workflow.md

# Brewboard smoke test (run from ~/src/brewboard after seed-reset)
# aigon seed-reset brewboard --force
# aigon feature-start 01 cu
# cat .aigon/state/feature-01-cu.json | grep '"status": "implementation-complete"'
# grep 'signal.agent_ready' .aigon/workflows/features/01/events.jsonl
# tmux has-session -t brewboard-f1-do-cu-format-date
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

- Automated CI test spawning a real agent binary (requires all agents installed; out of scope for CI).
- Changes to `lib/agent-registry.js` or `lib/worktree.js` — those are correct after today's cursor fixes; this feature only documents them.
- Modifications to `aigon/AGENTS.md` — reserved for `aigon-repo-internal-doc-reorg`.
- Adding `worktree-state-reconcile.test.js` assertions for a specific new agent (belongs in each individual agent-onboarding feature, guided by the template produced here).

## Open Questions

- Should `feature-01-format-date` replace the existing brewboard `feature-02-brewery-import` as the smoke test, or sit alongside it as a separate feature 01? **Default:** sit alongside — brewery-import is good for testing CSV handling; format-date is simpler and purpose-built as a canary.

## Related

- `aigon-repo-internal-doc-reorg` (inbox, `aigon-install-contract` set) — picks up the `docs/adding-agents.md` catalog entry
- Direct motivation: cursor agent `implementFlag` misconfiguration that caused multi-day blank-screen debugging (2026-04-28)
