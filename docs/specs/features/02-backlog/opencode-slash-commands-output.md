---
complexity: medium
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: opencode-slash-commands-output

<!-- Authoring AI: set `complexity:` using this rubric before writing the spec:
       low       — config tweaks, doc-only, single-file helpers, trivial bug fixes
       medium    — standard feature with moderate cross-cutting, one command handler, small refactor
       high      — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work
       very-high — architectural shifts, write-path-contract changes, new XState transitions, cross-cutting template+engine+frontend
     At start time, model and effort defaults come from each agent's `cli.complexityDefaults[<complexity>]` in
     `templates/agents/<id>.json` (not from this spec). Do not put model IDs in the spec. -->

## Summary

Emit OpenCode slash commands the way the Claude Code agent does today: install flat `aigon-*.md` prompt files under `.opencode/commands/` (same generic templates as `cc`), while retaining the existing skill tree at `.agents/skills/aigon-*/SKILL.md` as a secondary output. To make this generic, refactor `install-agent` to iterate over a list of output specs declared on the agent's JSON config (rather than the single `config.output` object), so any agent can ship multiple install targets without one-off conditionals.

This rebases the intent of `f4727b8e` (from the abandoned `feat/dashboard-drive-tool-label` branch) onto the current `lib/commands/setup.js` layout — note that the helper extraction in `304eff8f` only split _other_ helpers into `lib/commands/setup/`; `setup.js` itself still owns the install loop being edited here.

Do **not** carry over that branch's `op.json` `modelOptions` changes — `main` has the revised registry with `pricing`, `score`, `lastRefreshAt`, archived/quarantined entries — overwriting it would lose audit history.

## User Stories
<!-- Specific, stories describing what the user is trying to achieve -->
- As an OpenCode user with `op` installed in this repo, I can type `/aigon-feature-do` (and the rest of the `aigon-*` family) at the OpenCode prompt and get the same slash-command behaviour Claude Code users get from `.claude/commands/aigon/*.md`.
- As an Aigon agent author, I can declare multiple install targets for an agent in `templates/agents/<id>.json` and have `aigon install-agent` install all of them, without touching `setup.js`.
- As an existing OpenCode user already relying on `.agents/skills/aigon-*/SKILL.md`, I keep my skill tree on disk after upgrading — the new flat commands tree is additive, not a replacement.

## Acceptance Criteria
<!-- Specific, testable criteria that define "done" -->
- [ ] `templates/agents/op.json` declares an `outputs:` array (or equivalent list) with **two** entries: a `markdown` flat-commands output targeting `.opencode/commands/` with `commandFilePrefix: "aigon-"` and `.md` extension, and the existing `skill-md` output targeting `.agents/skills/`. The legacy single `output:` key is removed (or kept only as a deprecated alias resolved into the array at load time — pick one and document the choice in Technical Approach).
- [ ] `lib/commands/setup.js` iterates the array of outputs for each installed agent. Every output goes through the same install / alias / cleanup path that `config.output` goes through today — no `if (agent.id === 'op')` branches.
- [ ] After running `aigon install-agent op` in a fresh repo, `.opencode/commands/aigon-*.md` exists for every command in `templates/generic/commands/`, with the same frontmatter shape and aliases that `cc` produces under `.claude/commands/aigon/`.
- [ ] After the same install, `.agents/skills/aigon-<cmd>/SKILL.md` still exists for every command (skill tree preserved).
- [ ] Re-running `aigon install-agent op` is idempotent: no duplicate files, stale `aigon-*` files from previous runs are cleaned up in **both** trees, and exit code is 0.
- [ ] `aigon install-agent cc` is unchanged in behaviour (same files written, same frontmatter, same aliases) — verified by `git diff` of installed paths in a seed repo before/after this feature.
- [ ] `op.json` `modelOptions` array is **not** modified by this feature. Diff of `templates/agents/op.json` shows only the output-config change.
- [ ] `npm test` passes; the install-agent unit/integration tests cover both single-output (legacy) and multi-output configs.
- [ ] OpenCode resolves the new commands end-to-end: spinning up `opencode` in a seed repo (e.g. brewboard) shows `/aigon-help`, `/aigon-feature-do`, etc. in the slash-command palette, and invoking `/aigon-help` runs the same template body `cc` runs. Document the manual verification steps in the implementation log.

## Validation
<!-- Commands the iterate loop runs after each iteration (in addition to project-level validation). -->
```bash
node --check lib/commands/setup.js
node --check aigon-cli.js
npm test -- --testPathPattern='install-agent|setup'
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
<!-- High-level approach, key decisions, constraints, non-functional requirements -->

1. **Schema**: introduce `outputs: [...]` on the agent JSON config. Each entry has the existing keys (`format`, `commandDir`, `commandFilePrefix`, `commandFileExtension`, `skillFileName`, `frontmatter`, `global`). Loader (`loadAgentConfig`) normalises a legacy single `output:` object into a one-element `outputs:` array so other agents (`cc`, `gg`, `cx`, `cu`) need no JSON changes in this feature. Pick the loader as the single normalisation point; do not normalise inside `setup.js`.
2. **`op.json`**: replace the current `output:` block with two entries:
   - `{ format: "markdown", commandDir: ".opencode/commands", commandFilePrefix: "aigon-", commandFileExtension: ".md", frontmatter: ["description", "argument-hint"] }` — primary, mirrors `cc`'s shape but flat (no nested `aigon/` dir, since OpenCode discovers commands by filename prefix, not subdir).
   - `{ format: "skill-md", commandDir: ".agents/skills", commandFilePrefix: "aigon-", skillFileName: "SKILL.md", frontmatter: ["name", "description"], global: false }` — secondary, preserves existing tree.
   Confirm with the OpenCode docs that flat `.opencode/commands/aigon-*.md` is the supported discovery path; if it requires a subdir, set `commandDir` accordingly and update the AC.
3. **`lib/commands/setup.js`**: extract the `if (config.output) { ... }` block (around lines 358–540) into a helper `installAgentOutput(agentKey, config, outputSpec, ctx)` and call it once per entry in `config.outputs`. Cleanup of stale `aigon-*` files runs per-output (each output owns its own dir + extension). The cleanup glob must be scoped to its output's `commandDir` + prefix + extension — no cross-output deletions.
4. **Templates**: no changes to `templates/generic/commands/` — both outputs render the same source. The flat OpenCode output uses the same `processTemplate` pipeline; only the destination filename and frontmatter shape differ.
5. **Install logging**: emit one success line per output (`✅ Installed prompts: <commandDir>` + `✅ Skills: ... → <commandDir>/aigon-*/SKILL.md`) so multi-target installs are visible.
6. **Tests**: add fixture-based integration tests in `tests/integration/install-agent.test.js` (or the existing setup tests) that install `op` into a temp repo and assert both trees exist with expected file counts and prefixes. Add a regression test that `cc` install layout is byte-identical before/after.
7. **No frontend / dashboard / engine surface area**: this is install-path only.

## Dependencies
<!-- Other features, external services, or prerequisites. -->
- None. (Reference commit `f4727b8e` for the prior attempt's diff; do not cherry-pick — re-apply by hand against the current `setup.js`.)

## Out of Scope
<!-- Explicitly list what this feature does NOT include -->
- `op.json` `modelOptions` edits, pricing/score updates, model quarantine changes.
- Dashboard or workflow-engine changes.
- Any change to `templates/generic/commands/` template bodies, frontmatter rules, or the `processTemplate` pipeline.
- Adding new install targets for other agents (`gg`, `cx`, `cu`) — they keep their single output until a separate feature requests otherwise.
- Migrating the legacy single `output:` schema out of all other agents' JSON files (the loader normalises it; bulk rewrite is a follow-up).
- Anything from the abandoned `feat/dashboard-drive-tool-label` branch beyond the install-path intent of `f4727b8e`.

## Open Questions
- Does OpenCode discover `.opencode/commands/aigon-*.md` flat, or does it require a subdir (e.g. `.opencode/commands/aigon/*.md`)? Confirm against current OpenCode docs before finalising `commandDir`. The AC above assumes flat per the Summary; revise if docs disagree.
- Do OpenCode slash-command frontmatter keys match Claude's (`description`, `argument-hint`)? If different, list the supported keys in the loader rather than hard-coding `cc`'s set.

## Related
- Research: —
- Set: —
- Prior features in set: —
- Prior attempt: commit `f4727b8e` on abandoned `feat/dashboard-drive-tool-label` branch.
