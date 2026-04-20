# Feature: add-opencode-cli-coding-agent

## Summary
Add OpenCode as a first-class Aigon coding agent with agent ID `op`, installed via `aigon install-agent op` and launched through the same worktree-based Fleet/Drive flows used by existing agents. This feature is the first real proof that feature 246's simplification works in practice: adding a new agent should be mostly a matter of adding one `templates/agents/op.json` file plus the minimal supporting install/runtime wiring for any OpenCode-specific config files. OpenCode is a router/agent harness rather than a single-model vendor CLI, so Aigon must integrate the CLI and workflow behavior without hardcoding one default model inside Aigon itself.

## User Stories
- [ ] As a maintainer, I can add OpenCode to Aigon by registering one new agent config and running `aigon install-agent op`, without reintroducing hardcoded agent lists across dashboard/help/install surfaces.
- [ ] As a user who already has OpenCode configured, I can start a feature or research session with `op` and have Aigon launch it non-interactively with the correct prompt delivery path.
- [ ] As a user with a preferred OpenCode model/provider setup, I can keep that choice in OpenCode's own config rather than being forced into an Aigon-owned default model.
- [ ] As a maintainer validating a new agent candidate, I can confirm OpenCode satisfies Aigon's viability rules: headless launch, context delivery, completion signaling, and non-interactive permissions.

## Acceptance Criteria
- [ ] `templates/agents/op.json` exists and is the canonical source for OpenCode's agent metadata: ID, display names, aliases, CLI command, install hint, port offset, colors, capability flags, signal behavior, placeholder data, output/install format, and any OpenCode-specific config extras needed by `install-agent`.
- [ ] OpenCode appears automatically in registry-derived surfaces with no new hardcoded agent lists: `aigon install-agent` help/output, dashboard agent payload/UI, generated help text, prompt-template agent lists, and profile-derived port maps.
- [ ] `aigon install-agent op` succeeds and writes the expected OpenCode-owned files for project-local usage. The feature must explicitly document which files Aigon owns for OpenCode (for example, `.agents/skills/...` and any OpenCode config file Aigon is responsible for generating/updating).
- [ ] `buildRawAgentCommand()` / `buildAgentCommand()` can launch OpenCode headlessly for feature and research flows using the registry config, without requiring a TTY or interactive prompt entry.
- [ ] Prompt/context delivery for OpenCode is defined explicitly and works in both launch-time and installed-file usage. The implementation must choose one primary path and make it authoritative:
- [ ] Option A: OpenCode is treated like `cx` and receives inline prompt bodies for Aigon-spawned sessions while `install-agent op` writes reusable project-local skills for manual interactive use.
- [ ] Option B: OpenCode is treated as skill/slash-command invocable and Aigon launch/runtime paths point at installed skills/commands rather than inlining bodies.
- [ ] The chosen path must be reflected in `templates/agents/op.json` capability flags and in `lib/agent-prompt-resolver.js` behavior; no hidden special case outside the registry/resolver contract.
- [ ] Aigon does not hardcode a default implementation/review/eval model for OpenCode in the first release. If `templates/agents/op.json` contains model keys for compatibility with existing config shape, they are documented as optional placeholders or examples rather than a required Aigon-owned source of truth. The user's actual OpenCode model selection remains configurable in OpenCode's own config.
- [ ] `aigon doctor` / install warnings use OpenCode's registry metadata (`installHint`, CLI binary name, capability flags) and do not require a new hardcoded OpenCode-specific map in `lib/commands/setup.js`.
- [ ] Feature and research sessions launched with `op` still participate in Aigon lifecycle signaling correctly: shell-trap completion, heartbeat behavior, and `agent-status submitted/error` handling continue to work through the standard wrapped launcher path.
- [ ] A focused regression test proves the new agent is discoverable through the registry contract and that the chosen prompt-delivery path does not regress existing agents.
- [ ] Manual validation proves an end-to-end smoke path:
- [ ] `aigon install-agent op`
- [ ] `aigon feature-start <ID> op` (or equivalent launch path in a throwaway feature)
- [ ] the OpenCode session starts with the expected prompt shape
- [ ] the session can complete and signal back into Aigon without manual repair

## Validation
```bash
node -c lib/agent-registry.js
node -c lib/agent-prompt-resolver.js
node -c lib/worktree.js
node -c lib/commands/setup.js
npm test

# Feature-specific smoke checks
aigon install-agent op
aigon server restart
```

## Technical Approach
Implement this as a post-feature-246 registry-first agent addition, not as an ad hoc one-off integration.

1. Add `templates/agents/op.json`
This is the primary deliverable. Model the shape after `cx.json` and `cc.json`, but only include OpenCode-specific behavior that is actually required. The file should declare:
- `id: "op"` plus aliases/display labels
- CLI command (`opencode`)
- install hint
- provider family (`varies` or `router`)
- signal/capability flags
- prompt-delivery placeholders / command prefix if needed
- output format and install target(s)
- any config extras that `install-agent` must manage

2. Reuse the existing registry contract everywhere possible
Feature 246 already moved dashboard/help/install/port surfaces onto `templates/agents/*.json`. The OpenCode addition should primarily validate that contract rather than adding net-new plumbing. If adding `op.json` does not automatically light up a surface, fix the surface generically rather than introducing OpenCode-only branching.

3. Choose one launch-time prompt strategy and make it explicit
OpenCode supports project-local skills under `.agents/skills/<name>/SKILL.md` and also supports non-interactive CLI execution via `opencode run [message..]`. The implementation should decide whether Aigon-spawned OpenCode sessions behave more like:
- `cx`: inline the canonical prompt body so runtime launches do not depend on skill discovery, while still installing skills for manual use
- or a native skill/slash-command agent: launch via a short directive that OpenCode resolves from installed files

Default recommendation: start with the `cx`-style inline path for Aigon-spawned sessions, because it reduces risk from tool discovery/config drift and still lets `install-agent op` write repo-local skills for interactive/manual use.

4. Keep model ownership in OpenCode, not Aigon
OpenCode is a router/harness whose effective default model comes from the user's OpenCode config, with per-agent overrides possible on the OpenCode side. Aigon should not pretend OpenCode has one baked-in canonical model in the way Claude Code or Codex effectively do. For this feature:
- launching `op` should work when the user has already configured OpenCode globally or per-project
- Aigon may pass a model override only if the registry/config plumbing already has a clean, generic path for optional overrides
- otherwise, Aigon leaves model selection to OpenCode config and documents that expectation in generated agent docs

5. Scope the first release to CLI viability, not deep OpenCode customization
The first pass only needs enough integration to make OpenCode a reliable Aigon workflow participant. Advanced work such as telemetry parsing, rich OpenCode-specific permissions UX, or per-task model override authoring belongs in follow-up features unless it is required to make the agent viable at all.

6. Test the agent-add/remove claim for real
Because this feature is also a regression test for feature 246's simplification, implementation should include one contract-style test or fixture that proves `op` is picked up from the registry automatically and that removing `op.json` removes it from the same derived surfaces without extra code edits.

## Dependencies
- depends_on: agent-registry-single-source-of-truth
- A working local OpenCode CLI installation for manual validation
- User-configured OpenCode provider/model setup outside Aigon

## Out of Scope
- Designing a new generic Aigon abstraction for router-style model selection beyond what is required to make OpenCode usable
- Building a full OpenCode telemetry/cost ingestion pipeline unless basic lifecycle validation proves it is required
- Adding multiple new agents at once; this feature is specifically about OpenCode as the first post-246 candidate
- Rewriting historical docs/specs/logs to mention OpenCode everywhere
- Guaranteeing one blessed OpenCode model/provider combination for all users

## Open Questions
- Which installed file(s) should Aigon own for OpenCode beyond `.agents/skills/...`? If OpenCode needs a project config file for permissions or agent definitions, decide whether Aigon should write it or rely on user-owned config.
- Can OpenCode's process lifecycle be trusted to exit cleanly enough for Aigon's shell-trap completion path in all normal cases, or does it need a capability warning / fallback?
- Does OpenCode expose parseable transcript or session artifacts that make telemetry feasible later, or should `transcriptTelemetry` be `false` in the first release?
- Should `op.json` omit task-model entries entirely, or keep nullable/example values for compatibility with existing CLI-config readers?

## Related
- Research:
- [feature-246-agent-registry-single-source-of-truth](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-246-agent-registry-single-source-of-truth.md)
- [feature-201-pluggable-agent-architecture-zero-hardcoded-agent-logic](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-201-pluggable-agent-architecture-zero-hardcoded-agent-logic.md)
- [feature-277-harden-autonomous-loop-write-paths](/Users/jviner/src/aigon/docs/specs/features/05-done/feature-277-harden-autonomous-loop-write-paths.md)
- OpenCode CLI: https://opencode.ai/docs/cli/
- OpenCode agents/permissions: https://opencode.ai/docs/agents/
- OpenCode config/models: https://opencode.ai/docs/config/
- OpenCode skills: https://opencode.ai/docs/skills
