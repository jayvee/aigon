---
complexity: medium
set: doctor-triage
depends_on: [doctor-triage-digest]
---

# Feature: doctor-collapse-sections

## Summary

After `doctor-triage-digest` (F1) gives every section a structured status, the
default `aigon doctor` output is still ~120 lines because every healthy section
prints its full body — Prerequisites lists all 10 agents, Multi-Repo prints 9
green rows to flag 1 stale repo, the Port Health table dumps every port. This
feature makes the **default view compress anything healthy to a single
one-liner**, expanding only sections that have issues. A new `--full` flag
restores today's exhaustive output. The result: the default run drops from
~120 lines to ~20, and what remains is exactly the sections that need attention
plus the F1 triage digest.

## User Stories

- [ ] As a user, `aigon doctor` shows healthy sections as a single ✅ summary
  line and only expands sections that have problems, so the signal-to-noise is
  high.
- [ ] As a user debugging an install, I can run `aigon doctor --full` to see
  every section fully expanded, exactly as it prints today.

## Acceptance Criteria

### Collapsed default rendering
- [ ] Each section with `status === 'pass'` renders as one line:
  `✅ <Title> — <summaryLine>` (e.g. `✅ Prerequisites — node, git, tmux + 7 agents`).
- [ ] Sections with `status` `warn`/`fail` render their full body as today, so
  the user sees the detail for anything broken.
- [ ] The F1 triage digest still prints (now even more useful, since the body
  above it is short). With the body collapsed, the digest may also be printed at
  the top — implement per F1's open question resolution.
- [ ] Verbose-only sections that are purely informational even when healthy —
  "Agent install paths" and the full "Port Health" table — do NOT print in the
  default view at all; they are summarised (e.g. `✅ Port Health — no conflicts`
  or `⚠️ Port Health — 6 conflicts, 2 stale (see --full or --fix)`).

### `--full` flag
- [ ] `aigon doctor --full` expands every section to its current full output,
  including all-green agent lists, the complete port table, and Agent install
  paths.
- [ ] `--full` composes with existing flags (`--full --fix`, `--full --register`).

### Section summary lines
- [ ] Every section defines a healthy `summaryLine` (the collapsed form). These
  live with the section code, fed into F1's `DoctorReport.pass(id, title, summaryLine)`.
- [ ] Summary lines are concise (target ≤ 1 terminal line at 100 cols) and state
  the salient fact (counts), e.g. `9 current, 1 behind`, `7 of 7 authenticated`.

### Issue-bearing sections stay readable
- [ ] When a section has issues, its expanded body shows only the relevant
  detail where practical (e.g. Multi-Repo expanded shows the behind repo(s); the
  9 current repos collapse to a `…9 current` line). Full enumeration is available
  via `--full`.

## Technical Approach

- Build directly on F1's `DoctorReport`/section extraction. Each section is
  already a function `runXSection(report, ctx)`; this feature adds a render mode.
- Add a render decision: in default mode, a section prints its full body only if
  `status !== 'pass'`; otherwise it prints the one-liner. In `--full` mode it
  always prints the full body.
- Cleanest implementation: sections push their *full* lines into the report
  buffer rather than `console.log` directly, and the report decides what to emit
  based on mode + status. This completes the print-suppression refactor F1
  deliberately deferred.
- Port Health and Agent install paths become `--full`-only bodies with a
  summarised default line, since they are reference dumps rather than health
  signals.

### Default vs --full (illustrative default)

```
✅ Prerequisites — node 22, git, tmux + 7 agents
✅ Agent Auth — 4 of 7 authenticated (am, cx, km signed out)   ← warn: expands
⚠️  Multi-Repo — 9 current, 1 behind: farline (2.50.3)
⚠️  Port Health — 6 conflicts, 2 stale (aigon doctor --fix)
✅ Dashboard — running :4100   ·   ✅ Backup — weekly   ·   ✅ git identity
… (collapsed healthy sections)
─── Triage ─── (from F1)
```

## Dependencies
- depends_on: doctor-triage-digest (needs the structured section model + status).

## Out of Scope
- The structured issue model itself (F1).
- Scoped view flags (`--ports`, `--auth`) and interactive `--fix` (F3).
- Changing severity classifications (owned by F1).

## Open Questions
- Should multiple trivially-healthy single-line sections (Dashboard, Backup, git
  identity, Proxy) be merged onto one combined status line to save further
  vertical space, or kept one-per-line? Proposed: merge the always-trivial ones
  onto a single "Environment ✅" line; keep substantive sections separate.

## Related
- Set: doctor-triage
- Prior features in set: doctor-triage-digest
