# Implementation Log: Feature 277 - harden-autonomous-loop-write-paths
Agent: cc

## Plan

Implemented items (a)–(d) in spec order:

1. Capability flag. Chose `capabilities.resolvesSlashCommands` for the JSON
   field and `isSlashCommandInvocable(agentId)` as the registry helper —
   the helper's question ("can we hand this agent a slash command?") is
   the exact consumer need; the field describes the agent-side capability
   that answers it. Default is `false` (fail-closed). cc/gg declare `true`;
   cx and cu declare `false`.

2. Resolver `review-check` verb. Added to `VERB_TO_TEMPLATE` +
   `VERB_TO_PROMPT_FIELD` in `lib/agent-prompt-resolver.js`. Every agent
   JSON with any `*Prompt` field now carries `reviewCheckPrompt`.

3. New `buildReviewCheckFeedbackPrompt(agentId, featureId, { loadAgentConfig })`
   in `lib/agent-prompt-resolver.js` — single source of truth for the
   AutoConductor feedback injection. Slash-command agents receive the
   invocation sourced through `resolveAgentPromptBody` (→ `reviewCheckPrompt`).
   Non-invocable agents receive a path-pointer referencing the canonical
   skill file on disk, computed data-driven from `output.commandDir` /
   `output.commandFilePrefix` / `output.skillFileName`. `feature.js:2860`
   no longer contains any regex shape-sniff; the regex + its phantom
   fallback string are deleted.

4. Contract test at `tests/integration/autonomous-loop-injection.test.js`
   discovers agents via `fs.readdirSync('templates/agents')`, so any new
   agent landing without `capabilities.resolvesSlashCommands` will fail
   CI. Test trimmed overlapping cases from `agent-prompt-resolver.test.js`
   to keep net LOC change ≤ 0; budget ends at 1996/2000.

5. CLAUDE.md gets a **Write-Path Contract** subsection under State
   Architecture with F270/F272/F273 commit citations, and a Common Agent
   Mistakes bullet about hardening read paths without auditing parallel
   write paths.

## Injection-site audit (AC item (a), bullet 4)

`grep -rn "send-keys.*-l" lib/` returns three call sites today:

| Site                                  | Shape                                                     | Gating decision |
|---------------------------------------|-----------------------------------------------------------|-----------------|
| `lib/commands/feature.js:2853` (post replace) | AutoConductor feedback injection                   | Uses `buildReviewCheckFeedbackPrompt` → `isSlashCommandInvocable`. |
| `lib/dashboard-server.js:2077`        | `/api/session/ask` — relays user-typed prompt to running agent | Exempt: pure user input. No agent-command shape synthesised by aigon. |
| `lib/dashboard-server.js:3036`        | `/api/session-input` — dashboard "send keys" passthrough  | Exempt: pure user input, sanitizer strips control chars. |

The only site that ever synthesises agent-directive text on the user's
behalf is the AutoConductor site, and it is now capability-gated.

## Decisions

- **Default `resolvesSlashCommands` to `false` for unset agents.** Fail-closed
  matches the invariant: a new agent gets the path-pointer prompt (harmless)
  rather than a slash command that might not resolve.
- **Data-driven path pointer.** Reading `output.commandDir` / `commandFilePrefix`
  / `skillFileName` lets the pointer stay correct as install-agent layouts
  evolve. No hardcoded `.agents/skills/...` string in the builder.
- **Builder lives in `lib/agent-prompt-resolver.js`, not a new module.** This
  file is already the canonical home for "resolve what prompt text an agent
  should see". The launch-time and mid-session paths both belong here.
- **Preserved `resolveCxPromptBody` escape hatch.** `VERB_TO_TEMPLATE` includes
  `review-check → feature-review-check`, so an implementer who needs the
  full inlined body (e.g. skill file genuinely absent) can still call
  `resolveCxPromptBody('review-check', featureId)`. Default stays at the
  short path-pointer per spec guidance.
- **Test uses the builder's DI seam (`{ loadAgentConfig }`)** to prove the
  resolver doesn't depend on the agent-registry cache at test time; tests
  pass a stubbed loader that returns the real JSON body read inline.
- **`package.json` `test` script updated** — added the new test to the
  chained `npm test` command. Offsetting deletions made in the resolver
  test kept the LOC budget under the 2000 ceiling.

## Progress

- Commit `731255b5` — capability flag + helper + builder + feature.js injection.
- Commit `dca1c4ca` — contract test + resolver-test trim.
- This commit — CLAUDE.md Write-Path Contract + Common Agent Mistakes bullet + log.
