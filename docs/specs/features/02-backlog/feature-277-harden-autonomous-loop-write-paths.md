# Feature: harden-autonomous-loop-write-paths

## Summary
Three regressions in 24 hours (the unfixed `feature-prioritise` write-path bug that F270 explicitly deferred to a follow-up, then patched in `1c2766bc`; F272's reconciler thrashing files across registered repos, patched in `cbe3aeba` + `98ed172b`; the AutoConductor feedback-injection producing an unrunnable `$aigon-feature-review-check` phantom for cx, patched in `b9c39a26`) all share the same fingerprint: **one well-thought-through happy path plus parallel duplicate write paths that don't share its contract**. This feature closes that category on the autonomous-loop surface. It does three things: (a) replaces shape-sniffing regex in the AutoConductor with an explicit per-agent capability flag; (b) gives cx a deterministic, file-pointer-based mid-session directive contract that doesn't rely on codex reasoning its way through an unrunnable phantom command; (c) adds a write-path contract test that pins the invariant so the next asymmetry breaks a red test instead of a user's workflow.

None of this is new behavior — all three are defensive tightening of a surface that works today only because cx is clever enough to graceful-degrade. The value is eliminating the next F28x-class recurring regression before it happens.

## User Stories
- [ ] As a maintainer adding a new agent, I declare its mid-session invocation capability in one place (`templates/agents/<id>.json`) and every consumer picks it up — no regex shape-sniffing, no hand-maintained lists.
- [ ] As a cx user running autonomous mode, the AutoConductor's post-review feedback injection contains the actual skill body inlined into the prompt, so cx doesn't have to discover/resolve a skill name at runtime.
- [ ] As a future reviewer of any autonomous-loop code change, a contract test fails visibly if the injected prompt for any agent ceases to match that agent's declared invocation shape. No more "it worked on cc, forgot about cx" slip-throughs.
- [ ] As someone reading the CLAUDE.md "State Architecture" section, there is one sentence that explicitly names the read/write-symmetry invariant so the next F27x-era change comes in with test coverage from the start.

## Acceptance Criteria

### Capability flag (item (a))
- [ ] Each `templates/agents/<id>.json` has a `capabilities.slashCommandInvocable: boolean` field (or equivalent; name to be finalized during implementation — see Open Questions). cc/gg get `true`; cx gets `false`. cu gets `false` (retired agent — fail-closed rather than claiming a capability it won't be asked to exercise). Default when unset is `false` (fail-closed).
- [ ] `lib/commands/feature.js:2860` (the AutoConductor review-check injection) replaces the current regex `/[:/\-]$/.test(cmdPrefix) && !cmdPrefix.startsWith('$')` with a read of this capability. Deleting the regex is an acceptance signal — leaving both is wrong.
- [ ] `lib/agent-registry.js` exposes a helper (e.g. `isSlashCommandInvocable(agentId)`) so future consumers don't reimplement the check.
- [ ] **Full injection-site audit**: `grep -rn "send-keys.*-l" lib/` enumerates every mid-session tmux injection site (known today: `lib/commands/feature.js:2865`, `lib/dashboard-server.js:2077`, `lib/dashboard-server.js:3036`). Each call site is documented in the feature log as either (i) using `isSlashCommandInvocable` to gate agent-directive text, or (ii) explicitly exempt because it relays pure user input with no agent-command shape. No site may silently ship slash-command-shaped text to a non-invocable agent.

### Mid-session directive contract for non-slash-command agents (item (b))
- [ ] When `slashCommandInvocable === false` and the AutoConductor needs the agent to perform a command action (review-check, future feedback-addressed trigger, any mid-session directive), the injected prompt contains **the absolute-from-repo-root path to the canonical skill/template file** plus a compact action summary. Default shape: `Read \`<repo-root>/.agents/skills/aigon-<verb>/SKILL.md\` and follow its instructions for feature <id>. When done: aigon agent-status <signal>`. File path is preferred over inlining because the canonical template is long (`feature-review-check.md` is ~105 lines today) and `tmux send-keys -l` pastes verbatim into the session buffer — noisy for the user and potentially close to agent input-size limits.
- [ ] Full-body inlining via `agent-prompt-resolver.js` remains available as an escape hatch. If a specific directive genuinely needs inlined body (e.g. the skill file is not on disk in that worktree, or the agent provably cannot read files in that moment), the implementer documents the trade-off in the call site comment and pins the AC to that choice. Default is path-pointer.
- [ ] `lib/agent-prompt-resolver.js` gains a `review-check` verb mapping in both `VERB_TO_TEMPLATE` (→ `feature-review-check`) and `VERB_TO_PROMPT_FIELD` (→ `reviewCheckPrompt`). Every agent JSON that sets any `*Prompt` field in `cliConfig` gets a `reviewCheckPrompt` entry for slash-command agents. This pins the new verb as a first-class citizen in the resolver contract, not a grep-invisible shortcut.
- [ ] cc/gg behavior is unchanged: they still receive `${cmdPrefix}${verb} ${featureId}` — slash-command agents don't need path-pointer or inlining because their CLIs have native command resolution.

### Contract test (item (c))
- [ ] New test `tests/integration/autonomous-loop-injection.test.js` (or subsumes an existing test file to stay under budget). **The test discovers agent ids at runtime** via `fs.readdirSync('templates/agents')` (filter to `*.json`, load each) — it must NOT hard-code `['cc','gg','cu','cx']`. A new agent that lands without `capabilities.slashCommandInvocable` explicitly set will fail this test on CI, not silently slip through.
- [ ] For each discovered agent, the test asserts on the prompt built by the extracted helper (see Technical Approach step 7):
  - Slash-command agents (`slashCommandInvocable === true`): exact substring match for `${cmdPrefix}feature-review-check ${featureId}`. Use exact substring, not fuzzy regex — the helper produces deterministic output.
  - Non-invocable agents (cx today; default for any future agent): the prompt contains the exact skill file path (e.g. `.agents/skills/aigon-feature-review-check/SKILL.md`) AND a specific action verb ("Read", "follow", or equivalent) AND the signal command (`aigon agent-status feedback-addressed`). The prompt must NOT contain the phantom `$aigon-feature-review-check <id>` or `aigon feature-review-check <id>` strings.
  - Every case carries the regression comment: `// REGRESSION: commit b9c39a26 / autonomous feedback injection for cx was an unrunnable phantom command — see F273 session log for details.`
- [ ] Net test-suite LOC change ≤ 0. The new test either replaces equivalent older coverage 1-for-1 or is offset by deletions in the same commit. `bash scripts/check-test-budget.sh` passes at end of feature. (F274 landed the suite at 1974 LOC; this feature must not reopen the T3 budget fight that F276 is also under.)
- [ ] **Budget coordination**: if F276 lands first and tips `check-test-budget.sh` near ceiling, coordinate with F276's branch before claiming zero-net here. If no reasonable deletion target exists, use the T3 escape valve (explicit one-time bump request in the PR description) rather than sneaking the test in behind a flag or moving coverage out of `tests/integration/`.
- [ ] The test uses the `ctx` dependency-injection pattern (see CLAUDE.md "The ctx Pattern" section) so it doesn't need a real tmux session — it mocks `loadAgentConfig` per agent and asserts on the string that would be passed to `tmux send-keys`.

### CLAUDE.md invariant (item (d))
- [ ] `CLAUDE.md` gets a new **Write-Path Contract** subsection under "State Architecture" containing: *"Every write path (CLI command, autonomous-loop injection, hook-triggered transition) must produce the engine state its matching read path assumes exists — snapshot, event, or skill-file-pointer prompt for non-slash-command agents. Writes seed engine state; reads derive from it — never the reverse. Recent incidents: F270 → `1c2766bc` (prioritise missing snapshot), F272 → `cbe3aeba` + `98ed172b` (reconciler moving files across repos), AutoConductor → `b9c39a26` (cx injection phantom)."* The citations are load-bearing — abstract invariants fade; concrete hashes teach the next agent.
- [ ] The existing "Common Agent Mistakes" section gets one bullet naming this class of bug so an implementing agent reading CLAUDE.md pre-work is warned: *"Hardening a read path without auditing parallel write paths. Three separate bugs in 24 hours (commits `1c2766bc`, `cbe3aeba`, `b9c39a26`) came from this — always grep for every write path that produces the state the read path now assumes is present."*

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
- Research-side parity: no equivalent mid-session injection exists today (verified via `grep -rn "send-keys.*-l" lib/` enumerated in Technical Approach). `research-autonomous-start` does not inject review-check prompts into running sessions. If a research analogue is added later, it must adopt the same capability check from day one.

## Open Questions
- Capability flag name: `slashCommandInvocable`, `resolvesSlashCommands`, `hasNativeSlashCommands`, or `nativeCommandResolution`. Leaning toward `resolvesSlashCommands` — describes exactly what cc/gg/cu's CLIs do that cx's doesn't. Decide at implementation time based on what reads best in `lib/agent-registry.js`.
- For item (b), does `resolveCxPromptBody` currently do any variable substitution (`$ARGUMENTS`, `$1`) that would need to be mirrored in the injection-time path? Yes (`lib/agent-prompt-resolver.js:141`) — need to pass the feature ID as the equivalent argument when producing the path-pointer prompt for cx, and confirm escape-hatch full-body inlining handles the substitution identically to launch-time.
- Is there a per-agent maximum injection length the feedback prompt must stay under? Path-pointer prompt is ~3-4 lines, well under any limit. Full-body escape hatch would inject ~100+ lines for review-check — probably fine for codex but worth verifying at implementation time if the escape hatch is ever exercised.

## Related
- Commit `b9c39a26` — the hot-fix that this feature hardens.
- Commit `1c2766bc` — `feature-prioritise` snapshot fix (same read/write-asymmetry pattern on a different surface).
- Commits `cbe3aeba`, `98ed172b` — F272 reconciler hot-fixes (same pattern again).
- CLAUDE.md: "Testing Discipline" (T1, T2, T3) — the contract test exists under T3 ceiling with T2 regression comment.
- `lib/agent-prompt-resolver.js` — the canonical launch-time write path this feature extends to mid-session.
- `lib/agent-registry.js` — where the new capability helper lives.
