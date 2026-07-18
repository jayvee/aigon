---
complexity: medium
research: 46
set: deepen-create
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-18T05:43:37.949Z", actor: "cli/feature-prioritise" }
  - { from: "inbox", to: "backlog", at: "2026-04-29T23:21:51.440Z", actor: "cli/feature-prioritise" }
---

# Feature: deepen-create-3-toggle-and-quick-flag

## Summary

Establish the control contract used by the feature-create and research-create agent prompts. Default-on is the goal: thin specs are the current default failure mode and an opt-in flag would not be used by the people who need it most. Add a prompt-visible `--quick` per-call opt-out and a shared `deepen.enabled` config key with project-over-user precedence.

Deepen is behavior of an installed agent command, not of the bare CLI. The CLI remains a noninteractive scaffolder: it accepts `--quick` as a boolean no-op so the flag does not leak into description text, while the agent prompt reads the raw invocation and effective config before deciding whether to interview. This feature lands first so features #1 and #2 can consume a stable contract without temporarily shipping default-on prompts that have no opt-out.

## User Stories

- [ ] As a user invoking an installed feature-create or research-create agent command, I get the higher-quality deepen path by default.
- [ ] As a user in a hurry, I pass `--quick` to the agent command to skip the interview for that invocation.
- [ ] As a user who prefers one-shot creation across repositories, I run `aigon config set --global deepen.enabled false` once.
- [ ] As a project lead, I commit a project-level `deepen.enabled` value in `.aigon/config.json` so the repository can override the user default.
- [ ] As a shell user, bare `aigon feature-create` and `aigon research-create` remain noninteractive scaffold commands regardless of deepen configuration.

## Acceptance Criteria

- [ ] The feature-create and research-create CLI parsers accept `--quick` as a valueless boolean flag, do not include it in positional description text, and otherwise preserve today's scaffold output. The bare CLI does not attempt an interview.
- [ ] `deepen.enabled` is a recognised shared boolean config key with effective precedence: project `.aigon/config.json` > user `~/.aigon/config.json` > built-in default `true`. Per-call `--quick` is evaluated by the agent prompt before that effective value.
- [ ] `aigon config get deepen.enabled` returns the effective boolean with `project`, `global`, or `default` provenance, and `aigon config show` includes the effective value.
- [ ] `aigon config set deepen.enabled <bool>` writes the project override; `aigon config set --global deepen.enabled <bool>` writes the user override.
- [ ] The downstream prompts can implement the gate without another runtime API: inspect their raw invocation for `--quick`; otherwise run `aigon config get deepen.enabled` and skip only when the effective value is `false`.
- [ ] No mention of "grill" anywhere in code, config, or prompts.

## Validation

```bash
node -c aigon-cli.js
node -c lib/config.js
node -c lib/commands/feature.js
node -c lib/commands/research.js
aigon config get deepen.enabled
aigon config show | rg '"deepen"|"enabled"'
npm run test:iterate
```

## Technical Approach

- **CLI flag acceptance**: add `--quick` to the existing per-command parsers in `lib/commands/feature.js` and `lib/commands/research.js`. It consumes no following value, is not forwarded as description content, and does not alter `entityCreate`; the agent command is the behavioral consumer.
- **Config key**: add `deepen.enabled: true` to the existing default config source used by `getConfigValueWithProvenance`. Keep it a shared key so both project and global writes are valid, and reuse existing config resolution rather than adding a deepen-specific precedence path.
- **Prompt contract**: document for #1 and #2 that prompts inspect raw invocation arguments and the existing provenance-bearing `aigon config get` output. Do not add an unused `resolveDeepenEnabled` helper to the CLI.
- **Tests**: focused regression coverage proves both create parsers strip `--quick` without consuming adjacent description words, and config resolution covers project > global > default. Every new test carries the repository-required `// REGRESSION:` comment. No UI tests are required.
- **Restart server** after `lib/*.js` edits per CLAUDE.md hot rule #3.

## Pre-authorised

- May skip `npm run test:ui` mid-iteration — this feature touches no dashboard assets.

## Dependencies

-

## Out of Scope

- A `--deepen` inverse flag for one-call opt-in when globally disabled — explicitly rejected during research-eval as unnecessary cognitive cost. If the case ever materialises, add it then.
- A standalone `aigon spec-deepen <ID>` command for deepening existing specs — explicitly deferred. `feature-spec-review` already covers post-hoc improvement.
- Changing the deepen prompt bodies or their opt-out hint — those are features #1 and #2.
- Changing `feature-now`; it already bypasses `feature-create` and therefore cannot enter the deepen interview.
- Telemetry on how often `--quick` is used or how often deepen is globally disabled.
- A spec transcript / Q&A log artifact — explicitly rejected during research-eval (sidecar reflex; spec is the contract).
- A dedicated `resolveDeepenEnabled` runtime helper; no CLI runtime behavior consumes such a value.

## Open Questions

- None. The create command handlers own flag acceptance, and existing config provenance owns effective-value reporting.

## Related

- Research: #46 guided-entity-creation
- Set: deepen-create
- Prior features in set: —
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="240" viewBox="0 0 568 240" role="img" aria-label="Feature dependency graph for feature 686" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-686" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-686)"/><path d="M 244 66 C 284 66, 284 174, 324 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-686)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#686</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">deepen create 3 toggle an…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#687</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">deepen create 1 feature p…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="132" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="156" font-size="14" font-weight="700" fill="#0f172a">#688</text><text x="336" y="178" font-size="13" font-weight="500" fill="#1f2937">deepen create 2 research …</text><text x="336" y="198" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
