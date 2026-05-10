---
complexity: medium
research: 48
set: apply-model
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-10T09:01:58.793Z", actor: "cli/feature-prioritise" }
---

# Feature: apply-3-session-drift-notice

## Summary

A unified, named-both-sides drift notice rendered at every surface where the user is already engaging with aigon: agent SessionStart hooks (cc, gg, cu, **codex** — newly possible since `codex_hooks` shipped), a launcher wrapper for hookless agents (km, op), and `aigon check-version` CLI output. The notice always names *both sides* of any drift ("applied v2.63, installed v2.67") and quotes the exact next command. **Silent when current** — false positives are why the current notice gets ignored.

## User Stories

- [ ] As a customer starting a Claude Code / Codex / Cursor / Gemini session in a repo whose `.aigon/applied-digest` differs from what the installed CLI would write, I see one notice block at session start with one command to fix it.
- [ ] As a customer using Kimi or OpenCode (no hook framework), I get the same notice from the launcher wrapper before the agent starts — universal coverage independent of per-agent hook capability.
- [ ] As a customer in a repo where everything is current, I see **nothing** from the version check at session start — no "✓ aigon up to date" reassurance noise.
- [ ] As a customer with multiple kinds of drift (CLI behind npm, repo behind CLI, dashboard server behind CLI), I see one line per stale layer, each naming both sides and the resolving command.
- [ ] As a customer running `aigon check-version` manually, I get the same block format as the hooks/launcher — one canonical surface, never two voices.

## Acceptance Criteria

- [ ] A shared read-model `getRepoVersionStatus()` exists in `lib/version.js` (or a new `lib/version-status.js`) returning `{ appliedVersion, appliedDigest, installedCli, installedDigest, dashboardProcess, npmLatest, contentDelta }`.
- [ ] A renderer `formatDriftNotice(status, { stream })` produces the unified notice block, suppressing layers that are current.
- [ ] SessionStart hooks for cc, gg, cu, **and codex** install/update to call `aigon check-version --notice-only` (read-only, never mutates) and print the result to stderr.
- [ ] Codex hook is gated on `features.codex_hooks = true` in the agent's codex config; if unavailable, fall back to launcher wrapper.
- [ ] Launcher wrapper exists for hookless agents (km, op): when `aigon agent-start` (or equivalent) spawns one of these agents, the wrapper prints the same drift notice to stderr before exec'ing the agent process.
- [ ] When all three layers are current (digest match + dashboard process == CLI + npm == CLI), the notice prints **nothing** — zero output, no separator, no "✓".
- [ ] When only one layer is stale, only that line prints (plus separators).
- [ ] Each line follows the canonical format: observation naming both sides, then `Run: <command>`. No ambiguity about which command does what.
- [ ] No silent mutation in any code path triggered by the notice. Notice is read-only; the user runs the suggested command.

## Validation

```bash
node --check lib/version.js
# In-sync repo: zero output (notice goes to stderr — merge streams when piping)
aigon check-version --notice-only 2>&1 | wc -c | grep -q "^0$"
# Drift: notice contains both sides and the apply command
mkdir /tmp/test-drift && cd /tmp/test-drift && aigon apply
# tamper with installed CLI version (mock):
AIGON_TEST_INSTALLED_VERSION=99.99.99 aigon check-version --notice-only 2>&1 \
  | grep -q "applied v.*installed v99.99.99"
AIGON_TEST_INSTALLED_VERSION=99.99.99 aigon check-version --notice-only 2>&1 \
  | grep -q "aigon apply"
```

## Pre-authorised

- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets.

## Technical Approach

**Notice format (canonical):**

```
─────────────────────────────────────────────────
ℹ  aigon: this repo applied v2.63, installed CLI is v2.67.
   Re-apply with:  aigon apply

ℹ  aigon CLI v2.68 available on npm (you have v2.67).
   Upgrade with:   npm update -g @senlabsai/aigon

ℹ  Dashboard server still running v2.65 code (CLI is v2.67).
   Restart with:   aigon server restart
─────────────────────────────────────────────────
```

Lines are independently suppressed. Block is suppressed entirely if all three are current.

**SessionStart hooks (cc / gg / cu / codex):** Update the hook payloads in `templates/agents/*.json` to invoke `aigon check-version --notice-only` (the `--notice-only` flag — added in this feature — guarantees zero mutation regardless of any prior auto-fix behavior). Codex hook lands behind a `codex_hooks` capability check; if the installed Codex CLI doesn't support it, fall back to launcher wrapper.

**Launcher wrapper (km / op, plus codex fallback):** The agent-launch path in `lib/commands/agent-launch.js` (or wherever `aigon agent-start` actually lives) prepends a stderr write of `formatDriftNotice(getRepoVersionStatus())` before exec'ing the agent. This is the same shell-trap pattern documented in `lib/worktree.js:780-789`, just on entry rather than exit.

**Read-model.** `getRepoVersionStatus()` calls into:
- `getInstalledVersion(repoRoot)` for `appliedVersion`
- `readAppliedDigest(repoRoot)` and `computeAppliedDigest(cli)` for digest comparison (from feature #2)
- `getAigonVersion()` for `installedCli`
- Dashboard server version: read from a small file the dashboard writes on startup (e.g., `.aigon/dashboard-runtime.json` with `{ version, pid }`), or from a healthcheck endpoint if the dashboard is reachable
- `checkForUpdate()` from `lib/npm-update-check.js` for `npmLatest` (uses existing 5-min cache)

**Silence rule.** If `appliedDigest === installedDigest && dashboardProcess === installedCli && npmLatest <= installedCli`, return empty string. No fallback "everything's fine" message.

## Dependencies

- depends_on: apply-2-digest-drift-detection

## Out of Scope

- The dashboard pill (feature #4 — same data, different surface).
- Multi-repo notice ("3 of your repos are behind") — that's feature #5's npm postinstall hook.
- Sound/desktop notifications. Stderr text only.

## Open Questions

- For Codex: when `codex_hooks` is unavailable, is the launcher wrapper enough, or do we want a `~/.codex/instructions.md` snippet too? Default: launcher wrapper only — keep it one mechanism.
- Should the notice include a "next time you upgrade, this dashboard will guide you" hint on first stale-state encounter? Default: no — keep terse.

## Related

- Research: #48 aigon-versioning-model-and-multi-repo-update-ux
- Set: apply-model
- Prior features in set: apply-1-rename-update-verb, apply-2-digest-drift-detection
