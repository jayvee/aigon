---
aigon_id: F683
complexity: medium
agent: cc
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-18T00:22:09.424Z", actor: "cli/feature-prioritise" }
---

# Feature: rendered-agent-template-zero-opinion-guard

## Summary

Close a confirmed target-repo instruction leak and the checker blind spot that let it ship. `templates/agents/cx.json` and `templates/agents/cu.json` carry an `AGENT_DEV_SERVER_NOTE` placeholder whose text names `npm run dev`, `next dev`, and `.env.local` — and it renders into `.aigon/docs/agents/*.md` in **every** target repo regardless of profile (a Rust crate or iOS app gets Node/Next.js advice). `scripts/check-template-leaks.js` reports green because it scans only `templates/{generic,docs,specs,prompts,sections}` source files: `templates/agents/` is explicitly excluded and rendered install output is never checked. This feature makes the note profile-conditioned and stack-neutral, then extends leak checking to (a) agent JSON placeholder string values and (b) isolated rendered `install-agent` fixtures under an explicitly configured **generic** profile.

**Load-bearing distinction:** profile presets (`templates/profiles/`, `templates/profiles.json`) legitimately carry stack opinions — a user choosing the `web` profile has opted into npm/Next.js wording. The zero-opinion rule applies where Aigon does *not* know the stack: agent-level placeholders (which render for all profiles) and anything rendered under the `generic` profile. The guard must enforce exactly that boundary and not false-positive on profile preset content or on web-profile rendered output.

## User Stories

- As a user installing Aigon into a non-Node repo (Rust, Python, iOS…), I want `.aigon/docs/agents/*.md` to contain no npm/Next.js/`.env.local` assumptions, so the installed instructions are correct for my stack.
- As an Aigon maintainer, I want `check-template-leaks.js` (or a sibling guard) to scan agent JSON placeholder values and rendered install artifacts, so this class of leak cannot ship green again.
- As a user whose selected profile enables Aigon dev-server support, I still get the applicable Aigon commands and agent-specific mechanics without instructions assuming my package manager or framework.

## Acceptance Criteria

### Fix the confirmed leaks

- [ ] `cx.json` and `cu.json` `AGENT_DEV_SERVER_NOTE` no longer hardcode `npm run dev`, `next dev`, `.env.local`, or any replacement stack-specific command/path. Agent-specific mechanics such as Codex `--register-only` / persistent-terminal behavior may remain only if they are still accurate and are expressed using "the project's configured dev command" or equivalent stack-neutral wording.
- [ ] Resolve profile placeholders before rendering `.aigon/docs/agents/<agent>.md`. When the resolved profile/directives disable dev-server support, override `AGENT_DEV_SERVER_NOTE` to `""`; generic, library, iOS, and Android fixtures must therefore omit the whole note. Preserve the existing precedence for all unrelated agent placeholders.
- [ ] For a profile with dev-server support enabled, cx/cu agent docs still explain the applicable Aigon commands (`aigon dev-server start` / `url`, plus accurate agent-specific mechanics) without naming a package manager, framework, or target-owned env filename.
- [ ] Audit the remaining placeholder values in all `templates/agents/*.json` against the existing `LEAK_PATTERNS`; fix each real target assumption. In particular, replace `cc.json` `PERMISSION_SAVE_NOTE` examples such as `Bash(npm test)` / `Bash(npm:*)` with stack-neutral permission-pattern examples rather than suppressing them.
- [ ] False positives may use an explicit placeholder-key allow-list with a one-line rationale. Do not embed `<!-- aigon-internal-ok -->` in a placeholder value because that marker would itself render into the target repo; do not allow-list package-manager/framework examples merely because they are examples.

### Extend the guard

- [ ] `scripts/check-template-leaks.js` (or a focused sibling wired the same way) scans string values under `templates/agents/*.json` `placeholders` with the existing `LEAK_PATTERNS`. Findings name the JSON file, dotted placeholder key, matched text, and rule label.
- [ ] Extract the rule definitions and text-scanning primitive into an import-safe module (or make the existing script import-safe) so source scanning, placeholder scanning, rendered scanning, and tests share one rule set. Importing it must not execute `main()` or call `process.exit()`.
- [ ] Add a rendered-artifact check with **one separate temp repo per active agent**. Active IDs come from the agent registry/config (`active !== false`); do not hardcode today's list. Separate fixtures are required because cx/km/am/op can write the same `.agents/skills/aigon-*` paths and would otherwise overwrite one another. Deactivated agents such as `ag` and `gg` are skipped by construction.
- [ ] Each fixture explicitly writes `.aigon/config.json` with `{ "profile": "generic" }` before install rather than relying on an empty directory continuing to auto-detect as generic.
- [ ] Each fixture invokes the real `install-agent <id>` path, isolates `HOME` and `USERPROFILE` to a fixture-owned directory, and cleans up even when install or scanning fails. Resolve every scanned path under the fixture root before reading it.
- [ ] Scan the fixture's `.aigon/install-manifest.json` inventory, filtered to rendered textual instruction artifacts (`.md`, `.mdc`, command-template `.toml`, and any other explicitly enumerated text instruction extension). Do not recursively scan user-owned files, derived workflow state, model catalogs, or arbitrary settings JSON.
- [ ] Rendered output under the `web` profile is explicitly **not** scanned (profile opinions are opt-in); `templates/profiles/` content is not treated as a leak source.
- [ ] Add one focused enabled-dev-server profile render test for cx and cu to prove applicable Aigon guidance remains and stays stack-neutral. This is a behavior test, not an expansion of the generic leak scan to opt-in profile content.
- [ ] Guards are wired into the same stages as the existing template-leak check (`test:core` / `prepublishOnly`), not `test:iterate`; keep the iterate gate fast.
- [ ] Unit/integration coverage includes: a leaking placeholder fails; the clean source state passes; an injected leaking rendered artifact fails; every active agent was rendered in its own fixture; deactivated agents were skipped; generic cx/cu docs omit the dev-server note; and failures are actionable.

## Validation

```bash
node scripts/check-template-leaks.js
node tests/unit/template-leaks.test.js
node tests/integration/install-agent-rendered-leaks.test.js
npm run test:iterate
```

## Technical Approach

- Reuse `LEAK_PATTERNS` from `scripts/check-template-leaks.js` rather than inventing a second rule set; move them behind an import-safe API if a sibling rendered guard is cleaner.
- For placeholder scanning, walk `placeholders` values only (other agent JSON fields — model catalogs, benchmark URLs — legitimately contain vendor strings and must not be scanned).
- For agent-doc rendering, compute profile placeholders before the current `processTemplate(agentTemplateRaw, config.placeholders)` call in `lib/commands/setup/install-agent.js`; use the resolved dev-server enablement to include or blank `AGENT_DEV_SERVER_NOTE`, while leaving unrelated agent placeholder precedence unchanged.
- For the rendered check, follow the existing integration-test pattern (`tests/integration/install-agent.test.js`) for fixture setup, but use one explicitly generic and HOME-isolated fixture per agent. Read only manifest-tracked instruction artifacts.
- Keep static source/placeholder scanning fast. If real installs materially slow the script, put rendered fixtures in a focused integration test or sibling guard while preserving `test:core` and `prepublishOnly` coverage.

## Dependencies

- None. Independent of F657 (which is aigon-repo `AGENTS.md` slimming); the two were deliberately separated at F657's 2026-07-18 spec review.

## Out of Scope

- Any change to aigon's own root `AGENTS.md` (that is F657).
- Scanning profile preset content for stack opinions — presets are opt-in opinions by design.
- Redesigning the dev-server workflow or `--register-only` mechanics.
- Scanning non-placeholder agent JSON fields (model metadata, quota config).

## Open Questions

- One script or two? Extending `check-template-leaks.js` keeps one entry point; a sibling rendered guard keeps the fast static scan separate. Either is acceptable if rules are shared, imports are side-effect-free, and both `test:core` and `prepublishOnly` execute the rendered contract.

## Related

- Prior work: F657 spec review (2026-07-18, commit `c1a20c312`) — where this leak was found; F420 (consumer `AGENTS.md` is user-owned).
- Contract: `AGENTS.md` § "Target-repo boundary — zero opinion"; CLAUDE.md hot rule 10.
- Guard being extended: `scripts/check-template-leaks.js`.
- Offending values: `templates/agents/cx.json` `placeholders.AGENT_DEV_SERVER_NOTE`, `templates/agents/cu.json` `placeholders.AGENT_DEV_SERVER_NOTE`; consumer template `templates/generic/docs/agent.md` (`{{AGENT_DEV_SERVER_NOTE}}`).
