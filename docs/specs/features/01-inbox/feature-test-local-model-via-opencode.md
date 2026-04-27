---
complexity: low
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-27T02:28:18.098Z", actor: "cli/feature-prioritise" }
---

# Feature: test-local-model-via-opencode

## Summary
Run a real Aigon feature through OpenCode configured against a local Ollama model end-to-end. This is a hands-on validation that local model support works via the existing `op` agent slot, not a code change. The output is a short findings note documenting what worked, what didn't, and whether the claim "Aigon supports local models via OpenCode + Ollama" is accurate enough to put in the public comparison page (F399).

## User Stories
- [ ] As a maintainer, I can point OpenCode at a local Ollama model, run it as an Aigon `op` agent on a small feature, and confirm the lifecycle signals (implementing → submitted) fire correctly so the dashboard reflects real progress.
- [ ] As a contributor writing the comparison page, I have a first-hand test result to cite when claiming Aigon supports local models — not just a reading of OpenCode's docs.

## Acceptance Criteria
- [ ] Ollama is running locally with at least one code-capable model pulled (e.g. `qwen2.5-coder`, `codellama`, or `deepseek-coder`).
- [ ] OpenCode is configured via `~/.opencode.json` to use the local Ollama endpoint for one provider slot.
- [ ] A small throwaway feature (a one-file change or doc tweak) is run through `aigon feature-start <ID> op` with OpenCode using the local model.
- [ ] The agent completes the task and signals `agent-status submitted` — confirming the lifecycle handshake works with a local backend.
- [ ] A short findings note is written to `docs/local-model-test.md` covering: model used, config snippet, what worked, any rough edges (prompt compliance, speed, tool-call support).
- [ ] The note includes a one-line verdict: can we honestly claim local model support in public-facing copy, and under what caveats?

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
This is a validation task, not a code task. Steps:
1. `ollama pull <model>` — pick a code-capable model available locally.
2. Add a local provider block to `~/.opencode.json` (OpenCode's global config).
3. Create a trivial feature, start it with `op`, watch it run.
4. Record findings in `docs/local-model-test.md`.

No Aigon source changes expected. If the test surfaces a gap in the `op` agent integration (e.g. lifecycle signals don't fire, tmux session shape is wrong), file a follow-up feature rather than fixing in place.

## Dependencies
- depends_on: none

## Out of Scope
- Fixing any gaps found — those go in a follow-up feature.
- Benchmarking model quality or speed against cloud agents.
- Adding local model config to Aigon's own agent templates.

## Related
- Research: R25 — OpenCode comparison (confirmed OpenCode supports local Ollama)
- Research: R44 — competitive positioning (local model claim for public page)
