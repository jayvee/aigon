---
complexity: high
# agent: cc
depends_on: add-antigravity-agent
---

# Feature: retire-gg-deactivated-agent

<!-- Feature 2 of 2 in the antigravity-migration set. Introduces a first-class
     "deactivated agent" state and makes gg its first user. depends_on add-antigravity-agent
     so a working Google agent (ag) exists to swap into the Fleet rosters before gg leaves them. -->

## Summary
Now that Gemini CLI is dead (shut down 2026-06-18) and `ag` (Antigravity CLI) has replaced it (sibling feature `add-antigravity-agent`), the `gg` agent must stop being launchable. Rather than hard-deleting `gg` — which would orphan ~dozens of historic `feature-*-gg-*` telemetry records and force a null-guard at every render site — this feature introduces a **first-class `deactivated` agent state** and makes `gg` its first user. A deactivated agent **cannot be picked, installed, launched, probed, or appear in any workflow roster / Fleet picker**, but **remains in the registry for records**: historic telemetry/analytics, session-transcript parsing of old records, and display metadata (name, colour) all keep resolving. This mirrors the existing model-level `quarantined` state (`agent-registry.js`) promoted to the agent level, and generalises cleanly for the next CLI retirement.

## User Stories
- [ ] As a maintainer, I retire `gg` so it can no longer be picked or run anywhere, while every historic `gg` cost/token/eval record still renders correctly in analytics and `aigon stats`.
- [ ] As a maintainer, the deactivation is a reusable state, not a `gg`-specific hack — the next provider that kills its CLI gets retired the same way.

## Acceptance Criteria
### The deactivated-agent mechanism
- [ ] The registry supports a deactivated state: an agent config carrying `"active": false` (or a `deactivated: { since, reason, supersededBy }` block mirroring the `quarantined` audit shape) is excluded from a new `getLaunchableAgentIds()` / `isAgentLaunchable(id)` while still returned by `getAllAgentIds()` and resolvable via `getAgent(id)`.
- [ ] All ~22 `getAllAgentIds()` call sites are audited and routed to the correct enumerator: **all-known** (analytics, telemetry display, session-parse) vs **launchable-only** (install, Fleet & start-modal pickers, workflow rosters, `agent-probe` defaults, `feature-start` validation).
- [ ] Launch guard rails: `aigon install-agent gg`, `feature-start … gg`, and any launch path refuse with a clear "agent `gg` is deactivated (superseded by `ag`)" message rather than half-working.

### Retiring gg (first consumer)
- [ ] `templates/agents/gg.json` is reduced to a deactivated config: `"active": false` set, records-path fields retained (`name`/`displayName`/`shortName`, `providerFamily`, `terminalColor`/`bannerColor`, `runtime.*Strategy`), launch fields neutralised. **Not deleted.**
- [ ] `getAgent('gg')` still resolves; `getLaunchableAgentIds()` / `isAgentLaunchable('gg')` excludes it.
- [ ] Launch/roster/budget code no longer treats `gg` as active: `lib/workflow-definitions.js:47` drops `gg` from the implement roster (swapping in `ag`), `lib/config.js:189` auto-detection no longer offers `gg` as usable, `scripts/probe-agent.js`'s `case 'gg':` and default lists exclude it, and `lib/budget-poller.js`'s `SESSION_GG` polling is removed (see §budget-poller — not ported).
- [ ] Historic Gemini telemetry stays readable: `parseGeminiTranscripts()` (`lib/telemetry.js:713`) + the `gemini-chats` strategy (`lib/session-sidecar.js:36`) are **retained**; the dashboard analytics view and `aigon stats`/insights still show pre-existing `feature-*-gg-*` cost/token/eval rows with a sensible label (not blank, not a crash). Verify against this repo's existing `.aigon/telemetry/feature-525-gg-*.json` records.
- [ ] Launch-time-only Gemini code is removed: `presetGeminiTrust()` (`lib/worktree.js:1828`) and the `capture-gemini-telemetry` live-capture hook (`lib/commands/misc.js:1225`).
- [ ] `grep -rn "gemini\|'gg'\|\"gg\"" lib/ scripts/ templates/ docs/ AGENTS.md CONTRIBUTING.md` is triaged so **no `gg`/Gemini reference survives in a launchable/active code path**. Permitted survivors: the deactivated `gg.json`, the retained transcript parser/strategy, and analytics/display of stored `gg` rows — each intentional, none merely unnoticed.
- [ ] `.aigon/docs/agents/gemini.md` deleted or trimmed to a "retired → antigravity.md" stub.
- [ ] `npm run test:core` passes; the `gg` block in `tests/integration/worktree-state-reconcile.test.js` is removed or converted to assert `gg` is non-launchable.

## Validation
```bash
node -e "const r=require('./lib/agent-registry'); if (!r.getAgent('gg')) { console.error('gg should still resolve (deactivated, kept for records)'); process.exit(1); } if (typeof r.getLaunchableAgentIds==='function' && r.getLaunchableAgentIds().includes('gg')) { console.error('gg must not be launchable'); process.exit(1); } console.log('ok');"
```

## Technical Approach

Two parts: build the **deactivated-agent state** in the registry, then make **gg** its first consumer. They land together because the mechanism's natural test fixture *is* a real deactivated agent (gg) — a mechanism with no consumer is hard to verify.

### Part 1 — deactivated-agent state
- **Config**: a top-level `"active": false` (or `deactivated` audit block) on an agent JSON. Keep the records-path fields; the launch fields (`cli.*`, `authCheck`, `trust`, `installCommand`, `extras.settings.hooks`, `quota`) become inert.
- **Registry** (`lib/agent-registry.js`): `getAllAgentIds()` (`:35`) keeps returning every id. Add `getLaunchableAgentIds()` (active-only) + `isAgentLaunchable(id)` / `isAgentActive(id)`. Mirror the existing `quarantined` predicate/validation style (`:134`+).
- **Call-site audit** — the bulk of the work. Triage every `getAllAgentIds()` caller (~22) and each hardcoded roster/list into all-known vs launchable-only. Known launchable-only sites: `lib/workflow-definitions.js:47` (implement roster), `lib/config.js:189` (auto-detection), `lib/commands/misc.js:1590` + `scripts/probe-agent.js:248` (probe defaults), install + Fleet/start-modal pickers, `feature-start` validation.
- **Guard rails**: install/launch/probe paths reject deactivated ids with a clear message.

### Part 2 — retire gg (first consumer)
**Authoritative site finder — run first, triage every hit:**
```bash
grep -rn "gemini\|'gg'\|\"gg\"\|GEMINI" lib/ scripts/ templates/ docs/ AGENTS.md CONTRIBUTING.md tests/
```

Config / docs:
- `templates/agents/gg.json` — reduce to deactivated config (not delete).
- `.aigon/docs/agents/gemini.md` — delete or "retired" stub.
- `AGENTS.md` (roster sentence ~3, telemetry/module-map rows ~129/145/161/167, output-file list ~242, hook note ~250) — rewrite for `ag` and note `gg` retired. Line numbers indicative; grep.
- `docs/adding-agents.md` — `gg` is used as a *canonical example* throughout; replace with `ag` (or note `gg` as the retired-agent example).
- `tests/integration/worktree-state-reconcile.test.js` (~165/183) — remove or convert the `gg` block.

RETAIN (historic read path — do NOT delete):
- `lib/telemetry.js:713` `parseGeminiTranscripts()` + `:1594/:1603` dispatch + Gemini pricing rows; `lib/session-sidecar.js:36` `gemini-chats` strategy. These read old `gg` records and must keep working.

REMOVE (launch-time only):
- `lib/worktree.js:1828` `presetGeminiTrust()` and `:355` the `GEMINI_CLI_IDE_WORKSPACE_PATH` env comment. **NOTE:** worktree launch is config-driven — there are **no** `command === 'gemini'` branches to hunt for (an earlier draft cited 204/415/417 in error; those are generic config interpolation).
- `lib/commands/misc.js:1225` `capture-gemini-telemetry` live-capture hook + `:1247–1249` hardcoded `agentId = 'gg'`.

REPOINT / DEACTIVATE (launch/roster paths → launchable agents, drop `gg`, add `ag`):
- `lib/workflow-definitions.js:47`, `lib/config.js:189`, `lib/commands/misc.js:1317/1590`, `scripts/probe-agent.js:44/248`, `lib/commands/infra.js:925`, `lib/onboarding/wizard.js:319`, `lib/commands/setup-legacy.js`, `lib/agent-sessions/model.js:53`, `lib/agent-instructions-regen.js:90`.
- `lib/feature-close.js:456` `.gemini/settings.json` in `settingsFilesToReset` — drop or repoint to `ag`'s path.
- `lib/install-manifest.js:69/264`, `lib/template-drift.js:128/157` — `.gemini/commands/aigon/` → `'gg'` detection; repoint to `ag`'s output path (keep recognising `.gemini` historically only if needed for cleanup).
- Test/infra scripts (`scripts/reset-fixture.js`, `scripts/check-install-manifest-clean.js`, `scripts/test/build-auth-snapshot.sh`, `scripts/docker-inject-creds.sh`, `scripts/test/e2e-docker.sh`, `scripts/brewboard-clone-and-strip-aigon.sh`) — reference `.gemini` creds/fixtures; some carry real OAuth tokens (see authed-snapshot guidance) — audit, don't blind-edit.

### §budget-poller — do NOT silently port
`lib/budget-poller.js:21/556–607` spins a hardcoded `SESSION_GG` tmux session running `gemini --yolo`, sends `/model`, scrapes "Model usage" rows. This **cannot port to `ag`**: Antigravity shares one quota pool across desktop/CLI/SDK and reportedly can't self-report remaining quota. Remove the `gg` budget path; do not build an `ag` equivalent here (deferred — see `add-antigravity-agent` Out of Scope).

## Dependencies
- `depends_on: add-antigravity-agent` — `ag` must exist first so the Fleet implement roster (`workflow-definitions.js:47`) and probe defaults can be swapped `gg → ag` cleanly rather than left with a gap, and so users are never without a Google-model agent.
- Not self-contained to the agent-config layer: `gg`/`gemini` is hardcoded across ~22 files (rosters, auto-detection, budget polling, onboarding, telemetry). Budget for a cross-cutting change.

## Out of Scope
- Adding `ag` (sibling feature `add-antigravity-agent`).
- *Rewriting* historical `gg` telemetry files — the on-disk `feature-*-gg-*.json` records keep their `agent: 'gg'` id (they're genuinely a different product; relabelling Gemini history as Antigravity would be wrong). Only their *rendering* is in scope, handled by the deactivated state.
- Supporting enterprise Gemini Code Assist Standard/Enterprise users who may retain a working `gemini` CLI per Google's carve-out — `gg` is deactivated for everyone regardless, per maintainer decision.

## Open Questions
- **Deactivated-agent enumeration edge cases** (settle during implementation): does the dashboard start-modal hide deactivated agents entirely or show them greyed/disabled? Does `agent-probe --quota gg` (explicitly targeted) still run for diagnostics, or refuse like the launch paths? Pick the least-surprising behaviour and note it in `.aigon/docs/agents/`.
- Confirm `lib/feature-close.js`'s settings-reset list and the install-manifest/template-drift detection don't need to keep recognising `.gemini/` paths for cleanup of pre-existing installs before fully repointing to `ag`.

## Related
- Set: antigravity-migration
- Prior in set: add-antigravity-agent (this feature depends on it)
- Precedent: model-level `quarantined` state in `templates/agents/*.json` / `lib/agent-registry.js`; the "quarantine, don't delete" maintainer principle.
