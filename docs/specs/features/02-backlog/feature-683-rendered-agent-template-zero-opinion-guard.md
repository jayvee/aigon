---
aigon_id: F683
complexity: medium
agent: cc
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-18T00:22:09.424Z", actor: "cli/feature-prioritise" }
---

# Feature: rendered-agent-template-zero-opinion-guard

## Summary

Close a confirmed target-repo instruction leak and the checker blind spot that let it ship. `templates/agents/cx.json` and `templates/agents/cu.json` carry an `AGENT_DEV_SERVER_NOTE` placeholder whose text names `npm run dev`, `next dev`, and `.env.local` — and it renders into `.aigon/docs/agents/*.md` in **every** target repo regardless of profile (a Rust crate or iOS app gets Node/Next.js advice). `scripts/check-template-leaks.js` reports green because it scans only `templates/{generic,docs,specs,prompts,sections}` source files: `templates/agents/` is explicitly excluded and rendered install output is never checked. This feature generalises the offending placeholder text and extends leak checking to (a) agent JSON placeholder string values and (b) a rendered `install-agent` fixture under the **generic** profile.

**Load-bearing distinction:** profile presets (`templates/profiles/`, `templates/profiles.json`) legitimately carry stack opinions — a user choosing the `web` profile has opted into npm/Next.js wording. The zero-opinion rule applies where Aigon does *not* know the stack: agent-level placeholders (which render for all profiles) and anything rendered under the `generic` profile. The guard must enforce exactly that boundary and not false-positive on profile preset content or on web-profile rendered output.

## User Stories

- As a user installing Aigon into a non-Node repo (Rust, Python, iOS…), I want `.aigon/docs/agents/*.md` to contain no npm/Next.js/`.env.local` assumptions, so the installed instructions are correct for my stack.
- As an Aigon maintainer, I want `check-template-leaks.js` (or a sibling guard) to scan agent JSON placeholder values and rendered install artifacts, so this class of leak cannot ship green again.
- As a user on the `web` profile, I still get the concrete dev-server guidance (port allocation via `aigon dev-server`), sourced from profile placeholders where stack-specific wording is legitimate.

## Acceptance Criteria

### Fix the confirmed leaks

- [ ] `cx.json` and `cu.json` `AGENT_DEV_SERVER_NOTE` no longer hardcode `npm run dev`, `next dev`, or `.env.local` for all profiles. Either (a) generalise the wording ("your project's dev command", "the env file written by worktree setup") or (b) source stack-specific fragments from profile placeholders (`lib/profile-placeholders.js` already resolves `devServer` etc. per profile, with empty variants for non-applicable profiles). Keep the Codex-specific mechanics (`--register-only`, persistent terminal) — those are aigon/agent opinions, which are allowed.
- [ ] The dev-server behavioural contract is unchanged for `web`-profile installs: agents are still told to never start dev servers directly and to use `aigon dev-server start` / `url`.
- [ ] Audit the remaining placeholder values in all `templates/agents/*.json` against the existing `LEAK_PATTERNS`; fix or explicitly allow-list each hit. Known judgment call: `cc.json` `PERMISSION_SAVE_NOTE` uses `Bash(npm test)` / `Bash(npm:*)` as pattern-syntax examples — either swap to stack-neutral examples or mark with the escape valve and a comment.

### Extend the guard

- [ ] `scripts/check-template-leaks.js` (or a focused sibling wired the same way) scans string values in `templates/agents/*.json` `placeholders` with the existing `LEAK_PATTERNS`, honouring an escape-valve convention for deliberate exceptions.
- [ ] Add a rendered-artifact check: run `install-agent` for every **active** agent into a temp fixture repo with the **generic** profile, then run the leak patterns over the rendered outputs (`.aigon/docs/agents/*.md`, installed rules/command files). Deactivated agents (`ag`, `gg`) are skipped.
- [ ] The rendered check must isolate `HOME`/`USERPROFILE` so it never touches the maintainer's real `~/.aigon` registry (see 2026-06-18 incident) and must clean up its fixture.
- [ ] Rendered output under the `web` profile is explicitly **not** scanned (profile opinions are opt-in); `templates/profiles/` content is not treated as a leak source.
- [ ] Guards are wired into the same stages as the existing template-leak check (`test:core` / `prepublishOnly`), not the iterate gate if the rendered check is slow — keep the iterate gate fast.
- [ ] Unit/integration coverage: a fixture agent JSON with a leaking placeholder fails with an actionable message naming the file, key, and pattern; the clean state passes.

## Validation

```bash
node scripts/check-template-leaks.js
npm run test:iterate
```

## Technical Approach

- Reuse `LEAK_PATTERNS` and the escape-valve convention from `scripts/check-template-leaks.js` rather than inventing a second rule set; export the patterns if a sibling script is cleaner.
- For placeholder scanning, walk `placeholders` values only (other agent JSON fields — model catalogs, benchmark URLs — legitimately contain vendor strings and must not be scanned).
- For the rendered check, follow the existing integration-test pattern (`tests/integration/install-agent.test.js`) for fixture setup; render with `getProfilePlaceholders()` resolving to the `generic` profile.
- If generalising `AGENT_DEV_SERVER_NOTE` via profile placeholders, note the existing convention: "not applicable" profile variants return `""` and `processTemplate` collapses the blank lines.

## Dependencies

- None. Independent of F657 (which is aigon-repo `AGENTS.md` slimming); the two were deliberately separated at F657's 2026-07-18 spec review.

## Out of Scope

- Any change to aigon's own root `AGENTS.md` (that is F657).
- Scanning profile preset content for stack opinions — presets are opt-in opinions by design.
- Redesigning the dev-server workflow or `--register-only` mechanics.
- Scanning non-placeholder agent JSON fields (model metadata, quota config).

## Open Questions

- Generalise `AGENT_DEV_SERVER_NOTE` wording vs. compose it from profile placeholders? Wording-only is smaller; profile composition keeps concrete commands for web users. Implementer may choose either provided the acceptance criteria hold.
- One script or two? Extending `check-template-leaks.js` keeps one rule set; a sibling `check-rendered-leaks.js` keeps the fast static check separate from the slower fixture render. Prefer whichever keeps `test:iterate` unchanged.

## Related

- Prior work: F657 spec review (2026-07-18, commit `c1a20c312`) — where this leak was found; F420 (consumer `AGENTS.md` is user-owned).
- Contract: `AGENTS.md` § "Target-repo boundary — zero opinion"; CLAUDE.md hot rule 10.
- Guard being extended: `scripts/check-template-leaks.js`.
- Offending values: `templates/agents/cx.json` `placeholders.AGENT_DEV_SERVER_NOTE`, `templates/agents/cu.json` `placeholders.AGENT_DEV_SERVER_NOTE`; consumer template `templates/generic/docs/agent.md` (`{{AGENT_DEV_SERVER_NOTE}}`).
