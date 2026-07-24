---
aigon_id: F696
complexity: high
set: docs-release-readiness
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-24T23:19:44.625Z", actor: "cli/feature-prioritise" }
---

# Feature: restore-antigravity-agent-reliability

## Summary

Restore Antigravity CLI (`ag`, binary `agy`) as a launchable Aigon agent, but only after
verifying the current upstream release against the real Aigon lifecycle. F591 originally
added Antigravity and F592 retired Gemini CLI (`gg`); commit `cef60ae76` later deactivated
`ag` because authentication was unreliable and the documented token environment variables
did not work. Upstream issue #85 is closed and Antigravity 1.1.6 was released on 2026-07-24,
but headless/file-token issues #479 and #78 remain open. This feature must distinguish
Aigon's supported interactive TTY sessions from unsupported headless CI auth, use only
official Antigravity authentication, and re-enable `ag` only after a repeatable live run.

## User Stories

- [ ] As an Aigon user, I can install Antigravity, authenticate through its supported
      Google flow, select `ag` in the CLI/dashboard, and complete a feature or research
      session without being sent through login on every Aigon launch.
- [ ] As an autonomous/Fleet user, an Antigravity session receives the canonical Aigon
      prompt, can edit and run tools, signals completion, and retains Peek/transcript
      visibility like other launchable agents.
- [ ] As a maintainer, Aigon does not claim that `ANTIGRAVITY_TOKEN`, `AGY_TOKEN`, an API
      key, copied OAuth files, or another undocumented credential path works when upstream
      does not support it.
- [ ] As a maintainer, automatic doctor/quota polling never opens a browser or launches an
      interactive `agy` process behind the operator's back.

## Acceptance Criteria

### Prove the supported runtime

- [ ] Update the local/manual test installation to the current official Antigravity release
      (minimum 1.1.6 at implementation time), record `agy --version`, `agy --help`, and the
      relevant upstream issue/release state in the implementation log.
- [ ] On macOS, complete one official interactive Google sign-in, terminate the Antigravity
      process, start a fresh `agy` process, and verify whether it restores credentials
      without requiring another browser login. Record a redacted transcript.
- [ ] Verify Aigon's actual launch shape (`--prompt-interactive`, model flag, permissions
      mode, plugin/skill delivery) against the installed CLI rather than assuming F591's
      configuration is still current.
- [ ] If upstream 1.1.6 still cannot restore auth reliably in a fresh interactive process,
      do not flip `active` to true merely to satisfy the rest of this spec. Document the
      reproducible upstream blocker and leave the feature unsubmitted until there is a
      supported solution.

### Registry, onboarding, and launch behavior

- [ ] `templates/agents/ag.json` becomes active and its `deactivated` audit block is removed
      only after the live gate passes. `gg` remains deactivated for historical records.
- [ ] `getLaunchableAgentIds()` contains `ag` and excludes `gg`; install, feature/research
      start, reviewer/evaluator selection, workflow rosters, and dashboard pickers all use
      the launchable set.
- [ ] `aigon install-agent ag` installs the current Antigravity plugin/skills successfully
      in an isolated scratch repo and is idempotent.
- [ ] Antigravity authentication metadata reflects an actually supported check. Remove the
      fictitious `ANTIGRAVITY_TOKEN` / `AGY_TOKEN` success path unless upstream has shipped
      and documented it.
- [ ] Doctor reports an honest state (`authenticated`, `external/manual`, or unavailable)
      without spawning `agy`; it provides the official remediation command or interactive
      instruction.
- [ ] Automatic quota refresh continues to avoid interactive `agy`. Any quota integration
      must be a free, non-interactive, documented source; otherwise show unavailable rather
      than probing.
- [ ] A real Aigon smoke run proves: session launches, kickoff prompt is consumed, one file
      change/tool call succeeds, canonical completion is signalled, a second fresh Aigon
      session starts without manual re-authentication, and retained output is visible via
      Peek/session telemetry.

### Regression coverage

- [ ] Focused tests cover active/deactivated registry enumeration, launch rejection for
      `gg`, launch acceptance for `ag`, doctor never spawning `agy`, and install output.
- [ ] Every new regression test includes the required `// REGRESSION:` comment and the test
      suite remains within the LOC ceiling by consolidating lower-value duplicated coverage
      where needed.

## Validation

```bash
node -e "const r=require('./lib/agent-registry');if(!r.getLaunchableAgentIds().includes('ag'))process.exit(1);if(r.getLaunchableAgentIds().includes('gg'))process.exit(1)"
node tests/integration/doctor-agent-auth-probe.test.js
node tests/integration/quota-probe.test.js
npm run test:iterate
```

The live Antigravity/Aigon smoke is a required manual validation and must be recorded in the
implementation log; unit tests cannot substitute for it.

## Pre-authorised

- May update the locally installed Antigravity CLI through its official `agy update`
  mechanism for the required live compatibility test.
- May use an isolated scratch repository and temporary Aigon home for install/session tests.
- May skip the full browser suite mid-iteration; the deploy gate remains required at close.

## Technical Approach

Start by testing upstream behavior before changing the registry. Aigon's normal agents are
long-lived interactive sessions with a TTY, so an unsupported container/API-key path is not
automatically a blocker; repeated browser login in ordinary fresh sessions is. Keep that
boundary explicit.

Prefer configuration-driven corrections in `templates/agents/ag.json`, the existing
install-agent plugin path, terminal/session adapters, and doctor auth probe. Do not add
credential extraction, copy keyring material, call private Google endpoints, or use a
third-party OAuth proxy. Those approaches are unsupported and may violate provider terms.

After the live auth gate is green, restore `ag` to the launchable/default roster and exercise
the real Aigon lifecycle. Restart the dashboard after any `lib/*.js` edit.

## Dependencies

- External: a current official Antigravity CLI release whose interactive credential restore
  works reliably on the maintainer's macOS environment.
- No dependency on the `pro-merge` set.

## Out of Scope

- Re-enabling Gemini CLI (`gg`) or relabelling historical `gg` telemetry as Antigravity.
- Claiming headless CI/API-key support while upstream issues #479 and #78 remain unresolved.
- Bulk public-documentation replacement; F698 owns the user-facing `gg` → Antigravity pass.
- Any Aigon Pro terminology, packaging, gating, or merge work.

## Open Questions

- Does Antigravity 1.1.6 fully resolve the fresh-process macOS keyring problem, or only avoid
  a manual browser prompt after a short internal refresh?
- Can a supported non-interactive auth-status signal be read without launching the TUI?
- Should `ag` return to the default Fleet roster immediately, or remain opt-in for one release
  while marked experimental?

## Related

- F591 — add-antigravity-agent.
- F592 — retire-gg-deactivated-agent.
- Commit `cef60ae76` — deactivated `ag` after auth failures.
- Upstream: `google-antigravity/antigravity-cli` issues #85, #479, and #78; release 1.1.6.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 696" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-696" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-696)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-696)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#696</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">restore antigravity agent…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#698</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh public docs for c…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
