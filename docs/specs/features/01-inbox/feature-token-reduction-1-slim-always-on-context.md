# Feature: token-reduction-1-slim-always-on-context

## Summary
Cut the always-on prompt surface that every agent session pays for. Consolidate `CLAUDE.md` into `AGENTS.md` as the single source of truth, collapse the long "Worktree execution rules (MANDATORY)" + "Step 0" ceremony in the hot command templates (`feature-do`, `feature-start`, `feature-eval`, `feature-review`) to a one-line invariant, make profile placeholders render empty strings for "not applicable" variants, remove duplicate `aigon feature-spec` lookup paths when the spec has already been inlined, and prune retired-agent / superseded entries from `~/.claude/projects/<repo>/memory/MEMORY.md`. Research 35 measured ~250 lines of duplication between the root docs and ~280 lines of cross-template ceremony as the two largest Aigon-controlled startup sinks.

## User Stories
- [ ] As an agent operator, when I launch any `feature-*` session, I pay the minimum required always-on context so I stay inside my 5-hour usage window longer.
- [ ] As a template maintainer, I edit one canonical orientation file (`AGENTS.md`) instead of keeping `CLAUDE.md` and `AGENTS.md` in sync by hand.

## Acceptance Criteria
- [ ] `CLAUDE.md` shrinks to a short pointer file (≤ 30 lines) that directs the reader to `AGENTS.md`; the load-bearing content lives in `AGENTS.md`.
- [ ] Total line count of the four hot templates (`feature-do.md`, `feature-start.md`, `feature-eval.md`, `feature-review.md`) drops by ≥ 200 lines versus pre-change measurement, with the mandatory safety intent preserved as a single short invariant block.
- [ ] `lib/profile-placeholders.js` resolvers return `""` (plus trimmed surrounding blank lines) for the "not applicable" branch of every placeholder in the hot templates.
- [ ] No template instructs the agent to re-run `aigon feature-spec` when the spec body has already been inlined by the launching CLI command.
- [ ] `~/.claude/projects/-Users-jviner-src-aigon/memory/MEMORY.md` has retired-agent and superseded entries removed, with the corresponding topic files deleted.
- [ ] Pre/post prompt-size measurement is captured in the feature log for at least one representative `feature-do` launch per agent (cc, cx, gg).

## Validation
```bash
node -c aigon-cli.js
npm test
```

## Technical Approach
Edit only `templates/` sources, then run `aigon install-agent cc` (and the other installed agents) so working copies regenerate. Do not hand-edit `.claude/commands/` or `.cursor/commands/`. For the template ceremony collapse, preserve the functional intent — "the session must be executing inside the correct worktree" — as a single invariant such as `pwd && git branch --show-current` plus a one-line rule, moving the long failure-mode examples to an on-demand skill or `docs/` page if they are worth keeping at all. For the placeholder work, verify each resolver in `lib/profile-placeholders.js` — the current implementation renders explanatory prose even when the right answer is "skip this step". For the `CLAUDE.md` consolidation, diff `CLAUDE.md` against `AGENTS.md` first and keep only the net-new content when collapsing; the two files have near-identical Module Map / Rules / Common Agent Mistakes / Reading Order sections today.

## Dependencies
-

## Out of Scope
- Splitting `lib/commands/feature.js` or other oversized modules (target-repo refactor; separate lever).
- Claude prompt-caching of the stable prefix — handled in `token-reduction-4-claude-prompt-cache-stable-prefix`.
- AutoConductor / Autopilot cold-start amortization — handled in `token-reduction-3-autopilot-context-carry-forward`.
- Introducing per-turn telemetry — handled in `token-reduction-2-telemetry-and-audits`.

## Open Questions
- Which exact sub-sections of `CLAUDE.md` are load-bearing for the CC harness vs. pure reference that can move to `docs/architecture.md`? Decide during implementation by diffing against `AGENTS.md` and flagging any unique content for user review before deletion.
- Are any of the "MANDATORY" blocks preventing real incidents today, or are they scar tissue from past off-script behaviour that the harness now makes impossible? Confirm with `git log` on the templates before removing.

## Related
- Research: #35 token-and-context-reduction
