---
complexity: medium
set: doctor-triage
depends_on: [551]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-06-12T05:29:52.264Z", actor: "cli/feature-prioritise" }
---

# Feature: doctor-scoped-fix

## Summary

With the structured model (F1) and collapsed default view (F2) in place, this
feature adds the last layer of control: **scoped views** so a user can run just
the part of doctor they care about, and an **interactive `--fix`** that walks
each fixable issue with a confirm prompt instead of silently batch-applying
repairs. Together these turn doctor from a report you read into a tool you
drive: `aigon doctor --auth` for a fast daily login check, `aigon doctor --ports`
when debugging port collisions, and `aigon doctor --fix` as a guided,
consent-based remediation pass.

## User Stories

- [ ] As a user, I can run `aigon doctor --auth` to check only agent
  authentication (fast; ideal for a daily startup check), and pair it with
  `--fix` to be walked through logging in.
- [ ] As a user, I can run `aigon doctor --ports` to see only the full Port
  Health table when I'm actually debugging port conflicts.
- [ ] As a user, `aigon doctor --fix` asks me to confirm each repair before it
  runs, so I stay in control; `--fix --yes` keeps the current non-interactive
  batch behaviour for scripts.

## Acceptance Criteria

### Scoped view flags
- [ ] `--auth` runs only the Agent Auth section (supersedes/aligns with the
  existing `--auth-only` flag; keep `--auth-only` as an alias for compat).
- [ ] `--ports` runs only Port Health, always fully expanded (the reference
  table F2 hides by default).
- [ ] `--verbose` / `-v` is accepted as an alias behaviour toggle where useful
  (e.g. show Agent install paths) — reconcile with F2's `--full` so the two
  don't conflict (proposal: `--full` = expand all sections; `--verbose` = also
  show debug-only rows like install paths). Document the distinction.
- [ ] Scope flags compose with `--fix` (e.g. `--auth --fix` only remediates
  auth).
- [ ] An unknown/typo scope flag prints a short usage line listing valid scopes
  rather than silently running the full report.

### Interactive `--fix`
- [ ] `aigon doctor --fix` (without `--yes`) prompts per auto-fixable issue:
  shows the issue + the exact command, and asks to apply it (y/N, default N).
- [ ] `--fix --yes` (and `-y`) preserves today's behaviour: apply all
  auto-fixable repairs without prompting.
- [ ] Non-auto-fixable issues are listed at the end with their manual command
  but are never prompted for.
- [ ] The prompt path is safe in non-TTY contexts: if stdin is not a TTY and
  `--yes` was not passed, doctor does NOT hang — it prints the would-fix list
  and exits, instructing the user to re-run with `--yes` or interactively.
- [ ] After an interactive `--fix` run, doctor prints a summary: N applied, M
  skipped, K manual.

### Fix actions covered
- [ ] Interactive fix covers the auto-fixable issues already supported today
  (port conflicts, stale port entries, install-manifest regenerate, pending
  migrations, git hooks) plus the auth login-session remediation
  (open login command) and stale-repo `aigon apply` introduced by F546.
- [ ] Each fix's prompt label and command come from the issue's `fix` field
  defined in F1 — no fix logic is duplicated here.

## Technical Approach

- All scope/flag plumbing sits on top of F1's section functions and F2's render
  modes. A scope flag simply selects which `runXSection` functions execute and
  forces their expanded rendering.
- Interactive prompts: reuse the project's existing CLI prompt helper if one
  exists (check `lib/` for a readline/confirm utility before adding a new dep);
  otherwise a minimal `readline` y/N wrapper. Respect `process.stdin.isTTY`.
- The fix dispatch iterates `report.issues().filter(i => i.fix?.autoFixable)`;
  for each, in interactive mode confirm then run; in `--yes` mode run directly.
  This replaces the scattered `if (doFix) { … }` blocks currently inline in each
  section with a single consent-driven loop driven by the issue model.
- Keep backwards compatibility: `--fix --yes` must reproduce the current exact
  batch outcome so existing muscle memory / scripts / docs keep working.

## Dependencies
- depends_on: doctor-collapse-sections (which depends_on doctor-triage-digest).
  Needs both the issue model (fix metadata) and the render-mode plumbing.

## Out of Scope
- Adding new categories of fixes beyond what F1 already classifies as
  auto-fixable.
- JSON output mode.
- Any change to non-doctor commands.

## Open Questions
- `--verbose` vs `--full` overlap: confirm the intended split with the user. If
  it's confusing, collapse to a single `--full` and drop `--verbose`.
- Should interactive `--fix` offer an "apply all remaining (a)" option mid-walk,
  like a typical interactive rebase? Nice-to-have; default to plain y/N.

## Related
- Set: doctor-triage
- Prior features in set: doctor-triage-digest, doctor-collapse-sections
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="132" viewBox="0 0 868 132" role="img" aria-label="Feature dependency graph for feature 552" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-552" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-552)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-552)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#550</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor triage digest</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#551</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor collapse sections</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#552</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">doctor scoped fix</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
