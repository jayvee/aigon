---
complexity: high
set: doctor-triage
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T05:29:51.818Z", actor: "cli/feature-prioritise" }
---

# Feature: doctor-triage-digest

## Summary

`aigon doctor` is a ~120-line diagnostic dump where every section prints inline
via `console.log` (the handler is ~1,100 lines starting at `lib/commands/setup.js:1766`).
There are ~20 sections (Prerequisites, Agent Auth, Model Health, Multi-Repo,
Port Health, Signal-health, etc.), and the only summary is a single
`N issue(s) found` line at the very bottom — after the user has already scrolled
past everything. There is no severity classification and no consolidated "here
is what to do" list. This feature introduces a **structured issue model** that
every section reports into, classifies each issue by severity, and renders a
**triage digest** — a grouped, actionable rollup of every problem with its fix
command. This is the foundation the rest of the `doctor-triage` set builds on:
collapsing healthy sections (F2) and scoped/interactive views (F3) both consume
the per-section status object introduced here.

## User Stories

- [ ] As a user running `aigon doctor`, I see a single triage block that lists
  every issue grouped by severity with the exact command to fix it, so I can
  action the output without re-reading the whole report.
- [ ] As a user, I can tell at a glance which issues are blocking (can't work),
  which are degraded (works but suboptimal), and which are advisory (FYI).
- [ ] As a user, the digest tells me how many of the issues `--fix` can resolve
  automatically vs which need manual steps.

## Acceptance Criteria

### Structured issue model
- [ ] A `DoctorReport` collector object is introduced (new module, e.g.
  `lib/doctor/report.js`). Each section registers results into it instead of
  (or in addition to) printing directly.
- [ ] Each registered section result carries: `id` (stable slug, e.g.
  `agent-auth`, `port-conflicts`), `title`, `status` (`pass` | `warn` |
  `fail`), and zero or more `issues`.
- [ ] Each issue carries: `severity` (`blocking` | `degraded` | `advisory`),
  `message` (one line), optional `detail` (extra lines), and optional `fix`
  `{ label, command, autoFixable: boolean }`.
- [ ] Severity mapping is explicit per issue type (see Technical Approach
  table) — not inferred from the ⚠️/❌ glyph.

### Sections feed the model
- [ ] All existing doctor sections are refactored to register into the
  collector. The set of sections covered must include at minimum: Prerequisites,
  Agent Auth, Model Health, Terminal App, Multi-Repo Version Sweep, tmux
  Liveness, Dashboard Health, Shell PATH, git Identity, Port Health, Backup,
  Proxy Health, State Reconciliation, Signal-health (incl. stale-drive-branch),
  spec frontmatter, schema migrations, install manifest, workflow state
  (incl. legacy-worktree-location), profile sync.
- [ ] Issues currently buried inside other sections are first-class in the
  model: stale-drive-branches (today inside Signal-health) and
  install-manifest-corrupt each become their own issue entries.

### Triage digest rendering
- [ ] After all sections run, a `Triage` block is printed last, listing every
  issue grouped by severity (blocking → degraded → advisory), each on one line
  with: glyph, section, message, and the fix command (if any).
- [ ] The digest ends with a rollup line: e.g.
  `8 issues — 5 auto-fixable with \`aigon doctor --fix\`, 3 manual`.
- [ ] If there are zero issues, the digest prints a single healthy line
  (`✅ No issues found`) instead of an empty block.
- [ ] Exit code reflects worst severity (see Open Questions — default proposal:
  non-zero only for `blocking`).

### Compatibility
- [ ] The existing verbose per-section output is preserved for this feature
  (collapsing is F2's job). The digest is purely additive here.
- [ ] Existing flags (`--fix`, `--register`, `--auth-only`, `--gc`, etc.) keep
  working unchanged. `--fix` continues to resolve the same issues it does today;
  this feature does not change fix behaviour, only adds the digest + model.

## Technical Approach

### Where the model lives
New `lib/doctor/report.js` exporting a `DoctorReport` class:

```js
class DoctorReport {
  section(id, title) { /* returns a SectionBuilder */ }
  pass(id, title, summaryLine) { /* convenience: healthy section */ }
  // collects issues; computes counts by severity; knows auto-fixable count
  render(opts) { /* prints the triage digest */ }
  worstSeverity() { /* for exit code */ }
}
```

The `doctor` handler in `setup.js` constructs one `DoctorReport`, threads it
through each section, and calls `report.render()` at the end. To keep the diff
reviewable, sections can keep their current `console.log` bodies in this feature
and *additionally* push issues into the report (the print-suppression refactor
is F2). Prefer extracting each section into a small function
`runAgentAuthSection(report, ctx)` so F2 can later toggle its rendering.

### Severity mapping (initial)

| Issue | Severity |
|---|---|
| Required prereq missing (git, node<18) | blocking |
| Agent unauthenticated (installed agent) | degraded |
| Model warning (no metadata / no flag) | advisory |
| Terminal app configured but not installed | degraded |
| Repo version behind | degraded |
| tmux error (not "not started") | degraded |
| Dashboard unhealthy (configured + down) | degraded |
| Shell PATH mismatch | advisory |
| git identity missing | degraded |
| Port conflict | degraded |
| Port stale entry | advisory |
| Signal reliability < 70% | advisory |
| stale-drive-branch | advisory |
| install-manifest-corrupt | degraded (auto-fixable) |
| legacy-worktree-location | advisory |
| migrations pending | degraded (auto-fixable) |
| profile sync not configured | advisory |

This table is the single source of truth — encode it as data near the report
module, not scattered across sections.

### Digest format (illustrative)

```
─── Triage ─────────────────────────────────────────────
 degraded
  ⚠️  agent-auth     am, cx, km unauthenticated     aigon doctor --fix
  ⚠️  multi-repo     farline behind (2.50.3)        aigon doctor --fix
  ⚠️  port-health    6 conflicts                    aigon doctor --fix
  ⚠️  install        manifest invalid JSON          aigon doctor --fix
 advisory
  ℹ️  signal         cc reliability 64%             (review sessions)
  ℹ️  git-branches   5 stale drive branches         git branch -D …
  ℹ️  worktrees      3 in legacy location           (informational)
─────────────────────────────────────────────────────────
8 issues — 5 auto-fixable with `aigon doctor --fix`, 3 manual
```

## Dependencies
- None (this is the foundation member of the set).

## Out of Scope
- Collapsing or hiding healthy sections (F2 `doctor-collapse-sections`).
- Scoped view flags and interactive fix prompts (F3 `doctor-scoped-fix`).
- Changing what `--fix` actually repairs.
- JSON output mode for the digest (could be a later follow-up).

## Open Questions
- Exit-code semantics: should `degraded` issues make `doctor` exit non-zero, or
  only `blocking`? Non-zero on degraded is friendlier for CI/startup hooks but
  may surprise casual users. Proposed default: non-zero only for `blocking`.
- Should the digest also print at the *top* (visible without scrolling) once F2
  collapses the body? Likely yes after F2; for F1 keep it at the bottom.

## Related
- Set: doctor-triage
- Prior features in set: none (first)
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 550" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-550" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-550)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-550)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#550</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor triage digest</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#551</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor collapse sections</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#552</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor scoped fix</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
