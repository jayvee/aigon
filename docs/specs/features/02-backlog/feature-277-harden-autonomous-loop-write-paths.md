# Feature: harden-autonomous-loop-write-paths

## Summary
Three regressions in 24 hours (F270's unmet "state-changing commands refuse missing-snapshot entities" AC manifesting as `feature-prioritise` silently creating legacy entities; F272's reconciler thrashing files across registered repos; the AutoConductor feedback-injection producing an unrunnable `$aigon-feature-review-check` phantom for cx) all share the same fingerprint: **one well-thought-through happy path plus parallel duplicate write paths that don't share its contract**. This feature closes that category on the autonomous-loop surface. It does three things: (a) replaces shape-sniffing regex in the AutoConductor with an explicit per-agent capability flag; (b) gives cx the same "inlined skill body" contract for mid-session injection that initial launches already have via `agent-prompt-resolver.js`; (c) adds a write-path contract test that pins the invariant so the next asymmetry breaks a red test instead of a user's workflow.

None of this is new behavior — all three are defensive tightening of a surface that works today only because cx is clever enough to graceful-degrade. The value is eliminating the next F28x-class recurring regression before it happens.

## User Stories
- [ ] As a maintainer adding a new agent, I declare its mid-session invocation capability in one place (`templates/agents/<id>.json`) and every consumer picks it up — no regex shape-sniffing, no hand-maintained lists.
- [ ] As a cx user running autonomous mode, the AutoConductor's post-review feedback injection contains the actual skill body inlined into the prompt, so cx doesn't have to discover/resolve a skill name at runtime.
- [ ] As a future reviewer of any autonomous-loop code change, a contract test fails visibly if the injected prompt for any agent ceases to match that agent's declared invocation shape. No more "it worked on cc, forgot about cx" slip-throughs.
- [ ] As someone reading the CLAUDE.md "State Architecture" section, there is one sentence that explicitly names the read/write-symmetry invariant so the next F27x-era change comes in with test coverage from the start.

## Acceptance Criteria

### Capability flag (item (a))
- [ ] Each `templates/agents/<id>.json` has a `capabilities.slashCommandInvocable: boolean` field (or equivalent; name to be finalized during implementation). cc/gg/cu get `true`; cx gets `false`. Default when unset is `false` (fail-closed).
- [ ] `lib/commands/feature.js:2860` (the AutoConductor review-check injection) replaces the current regex `/[:/\-]$/.test(cmdPrefix) && !cmdPrefix.startsWith('$')` with a read of this capability. Deleting the regex is an acceptance signal — leaving both is wrong.
- [ ] `lib/agent-registry.js` exposes a helper (e.g. `isSlashCommandInvocable(agentId)`) so future consumers don't reimplement the check.

### Inline-skill contract for cx (item (b))
- [ ] When `slashCommandInvocable === false` and the AutoConductor needs to tell the agent to perform a command action (review-check, future feedback-addressed trigger, any mid-session directive), the injected prompt contains the actual command/skill body inlined via `agent-prompt-resolver.js`'s `resolveAgentPrompt` (or an equivalent helper). Not a prose nudge to "follow your skill."
- [ ] `resolveAgentPrompt` is extended (or a sibling helper is added) to produce a mid-session prompt variant: same inlined body, but with a preamble suitable for injection into an active session rather than a fresh launch. Signature should accept `{ agent, verb, featureId, context: 'launch' | 'midsession' }` or equivalent.
- [ ] cc/gg/cu behavior is unchanged: they still receive `${cmdPrefix}${verb} ${featureId}` — slash-command agents don't need inlining because they have native command resolution.

### Contract test (item (c))
- [ ] New test `tests/integration/autonomous-loop-injection.test.js` (or subsumes an existing test file to stay under budget). Covers, for each active agent (cc/gg/cu/cx):
  - The feedback prompt built by the AutoConductor review-check injection path contains the agent-appropriate invocation. Regex assertion: for slash-command agents, matches `^.*/aigon[:\-]feature-review-check \d+`; for cx, contains the inlined skill body (assert on a distinctive string from the skill, e.g. the skill's H1 or a specific step header) and does NOT contain the phantom `$aigon-feature-review-check <id>` string.
  - A regression check naming the three parent incidents: `// REGRESSION: commit b9c39a26 / autonomous feedback injection for cx was an unrunnable phantom command — see F273 session log for details.`
- [ ] Net test-suite LOC change ≤ 0. The new test either replaces equivalent older coverage 1-for-1 or is offset by deletions in the same commit. `bash scripts/check-test-budget.sh` passes at end of feature. (F274 landed the suite at 1974 LOC; this feature must not reopen the T3 budget fight that F276 is also under.)
- [ ] The test uses the `ctx` dependency-injection pattern (see CLAUDE.md "The ctx Pattern" section) so it doesn't need a real tmux session — it mocks `loadAgentConfig` per agent and asserts on the string that would be passed to `tmux send-keys`.

### CLAUDE.md invariant (item (d))
- [ ] `CLAUDE.md` "State Architecture" section (or a new "Write-Path Contract" subsection if it reads better) contains one sentence naming the invariant explicitly. Suggested wording: *"Every write path — CLI command, autonomous-loop instruction injection, or hook-triggered transition — MUST produce an engine action (workflow-core event, snapshot update, or inlined-skill-body prompt for non-slash-command agents) that matches the read-path contract. Writes seed engine state; reads derive from it — never the reverse."* Final wording to be decided during implementation.
- [ ] The existing "Common Agent Mistakes" section gets one bullet naming this class of bug so an implementing agent reading CLAUDE.md pre-work is warned: e.g. *"Hardening a read path without auditing the parallel write paths. Three separate bugs in 24 hours (F270, F272, b9c39a26) came from this — always grep for every write path that produces the state the read path now assumes is present."*

## Validation
```bash
node --check aigon-cli.js
node -c lib/agent-registry.js
node -c lib/agent-prompt-resolver.js
node -c lib/commands/feature.js
npm test
bash scripts/check-test-budget.sh
```

Manual scenarios:
- [ ] `grep -n "slashCommandInvocable\|CMD_PREFIX" lib/` shows the capability check is used via the new helper and not re-implemented anywhere. Regex-based shape-sniffing no longer appears in the autonomous-loop code.
- [ ] Run F276 (or any other in-progress feature) autonomously with cx as implementer and cc as reviewer. After cc signals `review-complete`, inspect the tmux buffer of the cx implementation session — the injected prompt contains the actual skill body, not the `$aigon-feature-review-check <id>` phantom, not the "follow your skill" prose.
- [ ] Run the same scenario with cc as implementer (e.g. cc implementer, cx reviewer). The injected prompt still starts with `/aigon:feature-review-check <id>` as it does today. No regression.

## Technical Approach

### Item (a) — capability flag
1. Add `capabilities.slashCommandInvocable` to each `templates/agents/<id>.json`. Default interpretation: if absent, `false` (fail closed — treat as non-invocable).
2. Add `isSlashCommandInvocable(agentId)` to `lib/agent-registry.js`. Keep it alongside the other capability lookups there.
3. Replace the regex at `lib/commands/feature.js:2860` with a call to the helper. Leave the one-line capability read; delete the regex and its inline comment.

### Item (b) — inlined skill body for cx
4. Inspect `lib/agent-prompt-resolver.js`. Today it has two paths: the default passes through `cliConfig.<verb>Prompt`; the cx path reads the generic command body, strips frontmatter, substitutes `$ARGUMENTS`/`$1`, returns the inlined text. (Per the CLAUDE.md description — verify at implementation time.)
5. Either extend `resolveAgentPrompt` to accept a `context` parameter, or add a sibling `resolveAgentInstructionForInjection` that reuses the same body-reading logic but wraps it in an injection-friendly preamble. Prefer the second option if the existing function signature is used widely — new caller, no risk to existing callers.
6. In `lib/commands/feature.js` at the injection site: if `slashCommandInvocable === false`, replace the `invocation` string with the resolver-produced inlined body, wrapped in a sentence like *"The review is complete. Please do the following, then signal completion with `aigon agent-status feedback-addressed`:\n\n<inlined body>"*.

### Item (c) — contract test
7. Create `tests/integration/autonomous-loop-injection.test.js`. Extract the prompt-building code from `lib/commands/feature.js:2851-2867` into a small testable helper first (e.g. `buildReviewCheckFeedbackPrompt(agentId, featureId, ctx)` in `lib/commands/feature.js` or a new `lib/autonomous-instruction-builder.js`), then the test calls the helper directly — don't test by spawning tmux.
8. For budget neutrality, audit the existing `tests/integration/lifecycle.test.js` for overlap — any test exercising "the AutoConductor triggers review" can either move into the new file or be deleted as subsumed. Aim for zero net LOC growth.

### Item (d) — CLAUDE.md
9. Add one sentence to "State Architecture" naming the write-path contract. Add one bullet to "Common Agent Mistakes" naming the asymmetry pattern with the three incident references.

### Execution order
Items in order (a) → (b) → (c) → (d), each as its own commit. (c) uses (a) and (b) so must come after. (d) is the cheapest and can piggyback on any commit or be its own.

## Dependencies
- None code-level. The capability flag is additive; existing agent JSONs without it continue to work (because the new helper defaults to `false` when the field is absent, and the only current caller falls through to the inline-body path for `false` — which itself is a new code path added by this feature, so no older caller is affected).

## Out of Scope
- Changing the semantics of the initial-launch `agent-prompt-resolver.js` code path. Only the mid-session injection path is touched; launch behavior is verified as unchanged.
- Replacing `CMD_PREFIX` in `templates/agents/*.json`. It's still the authoritative formatter for slash-command-invocable agents. The regex is what goes away, not the prefix string itself.
- Auditing every non-autonomous-loop write path for the same asymmetry. That's a bigger feature — this one is scoped to AutoConductor injection. Cross-cutting audit can come as a follow-up once the contract test shape is proven useful here.
- Moving tests out of `tests/integration/` into a new category. Keep the existing directory structure.

## Open Questions
- Should the capability flag be named `slashCommandInvocable` (behavior-focused) or something like `nativeCommandResolution` (capability-focused)? Leaning toward the former — it describes what the AutoConductor needs to know. Decide at implementation time based on what reads best in `lib/agent-registry.js`.
- For item (b), does `agent-prompt-resolver.js` currently do any variable substitution (`$ARGUMENTS`, `$1`) that would need to be mirrored in the injection-time path? Yes per CLAUDE.md — need to pass the feature ID as the equivalent argument when calling the resolver mid-session.
- Is there a per-agent maximum injection length the feedback prompt must stay under (e.g. some agents truncate long pastes to stdin)? Probably not for codex but worth a quick check during implementation — if yes, the inlined-skill-body path needs to be aware.

## Related
- Commit `b9c39a26` — the hot-fix that this feature hardens.
- Commit `1c2766bc` — `feature-prioritise` snapshot fix (same read/write-asymmetry pattern on a different surface).
- Commits `cbe3aeba`, `98ed172b` — F272 reconciler hot-fixes (same pattern again).
- CLAUDE.md: "Testing Discipline" (T1, T2, T3) — the contract test exists under T3 ceiling with T2 regression comment.
- `lib/agent-prompt-resolver.js` — the canonical launch-time write path this feature extends to mid-session.
- `lib/agent-registry.js` — where the new capability helper lives.
