---
schedule: monthly
name_pattern: top-3-simplifications-{{YYYY-MM}}
recurring_slug: monthly-top-3-simplifications
complexity: medium
---

# top-3-simplifications-{{YYYY-MM}}

## Summary

Audit the codebase and surface the **top three highest-leverage simplifications** that would make the project more maintainable, readable, understandable to AI agents, extensible, and performant. Produce a ranked report at `docs/reports/simplifications-{{YYYY-MM}}.md` **and** auto-file each of the three as a separate inbox feature via `aigon feature-create`. The user triages with `afp` — the audit task itself does not prioritise, start, or implement anything.

## Acceptance Criteria

- [ ] Walk `lib/`, `templates/`, `aigon-cli.js`, and `tests/` looking for the categories listed in the **Signals** section below
- [ ] Collect candidate simplifications with concrete file/line references
- [ ] Score each candidate on the five dimensions (maintainability, readability, AI-agent understandability, extensibility, performance) using the rubric below
- [ ] Pick the **top three** by total score, breaking ties by leverage (i.e., how much downstream code or future change is unblocked)
- [ ] Write `docs/reports/simplifications-{{YYYY-MM}}.md` using the report template below
- [ ] For **each** of the three picks, run `aigon feature-create "<short-kebab-name>" --description "<one-sentence summary; see report section N for full rationale>"`. Use a name like `simplify-<area>-{{YYYY-MM}}` so the inbox stays tidy
- [ ] Commit the report and the three new spec files together: `git add docs/reports/simplifications-{{YYYY-MM}}.md docs/specs/features/01-inbox/ && git commit -m "chore: top-3 simplifications report + inbox specs {{YYYY-MM}}"`
- [ ] Close the feature (no eval step needed — see Pre-authorised)

## Signals to look for

Don't read every file end-to-end — sweep for these signals first, then read deeply only where they fire.

**Maintainability**
- Functions or files over ~300 lines doing more than one thing (`wc -l lib/*.js | sort -nr | head -20`)
- Duplicated logic across `lib/` modules — same shape, slightly different names (use `grep -rn "function <verb>"` for common verbs like `validate`, `resolve`, `load`)
- Mutable shared state passed implicitly via `ctx` instead of explicit args
- Dead exports — exported names with no callers (`grep -rn "require.*<file>" .`)
- TODO/FIXME/XXX clusters in one area indicating accumulating debt

**Readability**
- Names that lie or under-specify (e.g., `data`, `obj`, `handle`, `process`)
- Boolean-flag explosions on a single function (>3 booleans suggests it should be split)
- Conditionals nested 3+ deep
- Inline comments that explain *what* well-named code already says (those should be deleted, not "improved")
- Magic numbers/strings used in 3+ places

**AI-agent understandability**
- Modules whose purpose is not obvious from the top 30 lines (no header comment, ambiguous filename, no clear single export)
- Implicit conventions that aren't written down in `AGENTS.md` or `CLAUDE.md`
- Spec/template/code triangles where the same fact lives in three places and can drift
- Indirection chains (3+ hops from CLI verb to the function that does the work) — make sure the chain is documented if it has to exist

**Extensibility**
- `if (agent === 'cc') ... else if (agent === 'gg') ...` ladders that should be data-driven (look for `templates/agents/*.json` patterns being bypassed)
- Hardcoded paths or repo-specific behaviour — the project is generic; per-repo facts belong in `.aigon/config.json`
- Feature flags / profile branches that have outlived their purpose
- Closed-over registries that should be open-for-extension

**Performance**
- Sync filesystem walks where one cached read would do (`fs.readdirSync` in hot paths)
- Repeated `JSON.parse` of the same file inside a request
- N+1 patterns in dashboard endpoints
- Test-only code paths that ship in production bundles

## Scoring rubric (per candidate)

For each candidate, score 1–5 on each dimension. **Total = sum of the five scores.** Use the leverage tiebreaker only for ranking the top 3.

| Score | Meaning |
|-------|---------|
| 1     | Trivial — affects one local site only |
| 2     | Minor — improves one file or one module |
| 3     | Moderate — improves a subsystem (e.g. all of `lib/workflow-core/`) |
| 4     | Major — improves how the whole codebase is read or extended |
| 5     | Foundational — unblocks several queued features or removes a class of bugs |

Be conservative — most things are 2 or 3.

## Auto-filing as inbox features

After the report is written, file each of the three picks as a feature spec in `01-inbox/`. The user will triage with `afp`/`afd` — do not prioritise, start, or implement.

For each pick, run:

```sh
aigon feature-create "simplify-<short-area>-{{YYYY-MM}}" --description "<one-sentence summary>. See docs/reports/simplifications-{{YYYY-MM}}.md § <section> for scoring and proposed change."
```

Naming guidance:
- `<short-area>` should be a kebab slug pointing at the affected module or pattern, e.g. `agent-resolution`, `dashboard-endpoint-batching`, `ctx-explicit-args`
- Keep the description to one sentence; the full rationale lives in the report
- Don't include the rank in the name — ranks are a snapshot, the spec should stand alone

If `feature-create` fails for any pick (e.g. duplicate name from a previous month's report), append `-v2` and retry once. If it still fails, log the error in the report's "What was *not* filed" section and continue with the remaining picks.

## Report template

Write the report to `docs/reports/simplifications-{{YYYY-MM}}.md`:

```markdown
# Top-3 simplifications — {{YYYY-MM}}

Generated by recurring task `monthly-top-3-simplifications`. Each pick was auto-filed as an inbox feature; pick what's worth prioritising with `afp`.

## Codebase snapshot

- Commit: <SHA at time of scan>
- Lines of JS in `lib/`: <number>
- Number of files in `lib/`: <number>
- Number of recurring + active feature specs: <number>

## Ranked simplifications

### 1. <Short title>

**Inbox feature:** `simplify-<area>-{{YYYY-MM}}` (filed via `feature-create`)

**Where:** `<file>:<line>` (and any related sites)

**Today:** <2-3 sentence description of the current state, with one short code excerpt if it helps>

**Proposed:** <2-3 sentence description of the simplification — concrete, not abstract>

**Why now:** <one sentence on what this unblocks or stops costing>

**Scores:** maintainability X / readability X / AI-clarity X / extensibility X / performance X — **total: X / 25**

**Effort:** small / medium / large

---

### 2. <…>

(repeat the same shape for ranks 2–3)

## Honourable mentions

Anything that scored well but didn't make the top 3 — list as a single line each: `<title> — <file>:<line> — <total>/25`. These are *not* filed as features.

## What was scanned

- <directories walked>
- <signals checked, briefly>

## What was *not* scanned

- <anything intentionally skipped, e.g. `node_modules/`, generated `.claude/commands/`>

## What was *not* filed

- <any pick whose `feature-create` call failed, with the error and the manual recovery step>
```

## Constraints

- **Do not modify any code under `lib/`, `templates/`, or `aigon-cli.js`.** This task only writes the report and runs `feature-create` for the three picks.
- **Do not run `aigon feature-prioritise`, `feature-start`, or `feature-do` for the picks** — the user triages.
- Run args verbatim; never add agents/flags from context.
- Templates source of truth is `templates/generic/commands/`; never edit `.claude/commands/` working copies.
- Treat `.aigon/`, `node_modules/`, generated agent command directories, and worktree checkouts as out of scope.
- If a candidate from last month's report is still un-actioned (still in `01-inbox/` or `02-backlog/`), do **not** re-file it — note the duplicate in the new report's entry instead. Repeat candidates aren't a failure, they're a signal.

## Pre-authorised

- Skip eval step: this is a reporting task with no code changes requiring review beyond the per-pick feature flow that follows.
- Write to `docs/reports/simplifications-{{YYYY-MM}}.md` and run `aigon feature-create` up to 3 times.
- Commit with message `chore: top-3 simplifications report + inbox specs {{YYYY-MM}}`.
