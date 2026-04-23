# Feature: recurring-features

## Summary

Add a "Recurring Features" capability to Aigon: template specs stored in `docs/specs/recurring/` that the server automatically instantiates and prioritises on a schedule. Each template is a standard feature spec with a `schedule:` frontmatter field. On server startup and once every 24 hours, Aigon checks whether any template is due for the current ISO week (Mon–Sun). If due and no open instance exists, it clones the template into inbox and immediately prioritises it (assigns an ID, moves to backlog). The user opens the dashboard, sees it ready to start, and runs it like any other feature. No new workflow concepts — recurring work is just features that appear automatically.

## User Stories

- [ ] As a user, I want routine tasks (dependency sweep, docs gap scan) to appear in my backlog automatically each week so I never have to remember to create them
- [ ] As a user, I want to be able to create my own recurring features by dropping a template file into `docs/specs/recurring/`
- [ ] As a user, if last week's instance is still open, I do not want a duplicate created — the existing one covers the work
- [ ] As a user, I want to trigger a manual check from the CLI if I want to create due features without waiting for the server

## Acceptance Criteria

### Template format
- [ ] Templates live in `docs/specs/recurring/` (gitignored from kanban scanning, not displayed on board or dashboard)
- [ ] Template frontmatter supports: `schedule: weekly` (only `weekly` in v1), `name_pattern: <string>` using `{{YYYY-WW}}` (ISO year + week number) for the instantiated feature name
- [ ] Template body is a standard feature spec (Summary, User Stories, Acceptance Criteria, etc.) — cloned verbatim into the new inbox spec, with the name rendered from `name_pattern`
- [ ] Missing or malformed `schedule` frontmatter skips the file with a server log warning

### Scheduling logic
- [ ] Check runs once immediately on server startup and then every 24 hours via a separate `setInterval` — completely independent of the dashboard poll loop
- [ ] "Due" means: the current ISO week (Mon–Sun, ISO 8601) has no open instance of this template across inbox, backlog, in-progress, and in-evaluation. Done and paused instances do not block creation
- [ ] When due: clone the template, render `name_pattern`, write to `docs/specs/features/01-inbox/`, immediately run `feature-prioritise` to assign an ID and move to backlog
- [ ] Last instantiation date tracked per template in `.aigon/recurring-state.json` (gitignored)
- [ ] Server log records each check: templates found, how many due, how many created, how many skipped (with reason)

### Manual trigger
- [ ] `aigon recurring-run` command performs the same due check and creation logic on demand — useful for testing templates and for running after adding a new template mid-week
- [ ] `aigon recurring-list` shows all templates, their schedule, last instantiation date, and whether they are due this week

### Built-in templates
- [ ] `docs/specs/recurring/weekly-dep-sweep.md` — weekly feature that runs `npm audit` and `npm outdated`, writes findings to `docs/reports/dep-sweep-{{YYYY-WW}}.md`, and closes. Agent implements and closes; no eval step needed
- [ ] `docs/specs/recurring/weekly-docs-gap-scan.md` — weekly feature that diffs `lib/` and `templates/` changes since the last authoritative-doc commit (`AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`), writes gap report to `docs/reports/docs-gap-{{YYYY-WW}}.md`, and closes

### Documentation
- [ ] `docs/development_workflow.md` gets a "Recurring Features" section explaining the template format, `docs/specs/recurring/`, the weekly ISO cadence, and how to add a custom template
- [ ] `AGENTS.md` updated to mention `docs/specs/recurring/` in the directory map

## Validation

```bash
node -c lib/dashboard-server.js
node -c lib/commands/misc.js
aigon recurring-list
```

## Technical Approach

### Template scanning and due check (`lib/recurring.js`, new)

```js
// Pseudo-code
function checkRecurringFeatures(repoPath) {
    const templates = scanTemplates(path.join(repoPath, 'docs/specs/recurring'));
    const state = readRecurringState(repoPath);          // .aigon/recurring-state.json
    const currentWeek = getISOWeek();                    // e.g. "2026-W17"

    for (const template of templates) {
        if (template.schedule !== 'weekly') continue;
        if (state[template.slug]?.lastWeek === currentWeek) {
            log(`Skipping ${template.slug} — already created this week`);
            continue;
        }
        if (hasOpenInstance(repoPath, template.slug)) {
            log(`Skipping ${template.slug} — open instance exists`);
            state[template.slug] = { lastWeek: currentWeek };  // mark done
            continue;
        }
        const featureName = renderPattern(template.namePattern, currentWeek);
        createFeatureFromTemplate(repoPath, template, featureName);
        prioritiseFeature(repoPath, featureName);
        state[template.slug] = { lastWeek: currentWeek };
        log(`Created and prioritised: ${featureName}`);
    }
    writeRecurringState(repoPath, state);
}
```

### Open instance check

Scan `01-inbox/`, `02-backlog/`, `03-in-progress/`, `04-in-evaluation/` for any filename containing the template slug. Done (`05-done/`) and paused (`06-paused/`) are explicitly excluded — a closed or abandoned instance does not block the new one.

### Server wiring (`lib/dashboard-server.js`)

```js
const { checkRecurringFeatures } = require('./recurring');

// In startServer(), after the poll loop is started:
checkRecurringFeatures(repoPath);
setInterval(() => checkRecurringFeatures(repoPath), 24 * 60 * 60 * 1000).unref();
```

No interaction with `pollStatus` or `scheduleNextPoll`.

### CLI commands (`lib/commands/misc.js` or new `lib/commands/recurring.js`)

- `aigon recurring-run` — calls `checkRecurringFeatures()` and prints a summary
- `aigon recurring-list` — prints each template with schedule, last week created, and due/not-due status for the current week

### State file (`.aigon/recurring-state.json`, gitignored)

```json
{
  "weekly-dep-sweep": { "lastWeek": "2026-W17" },
  "weekly-docs-gap-scan": { "lastWeek": "2026-W17" }
}
```

Simple enough that no migration is needed if the file is absent — treat missing as "never run."

## Dependencies

- None — the existing `feature-prioritise` CLI path handles ID assignment and git commit

## Out of Scope

- `schedule: daily` or `schedule: monthly` (v1 is weekly only; the schedule field is designed for extension)
- Dashboard UI for managing recurring templates (edit, disable, force-run) — CLI is enough for v1
- Cross-repo recurring features — each repo manages its own `docs/specs/recurring/`
- Autonomous execution of the instantiated feature — user still decides when to start it
- Email or push notifications when a new recurring feature is created

## Open Questions

- Should `recurring-run` be a no-op if nothing is due (just log "nothing due"), or should it support `--force` to create regardless of dedup? Lean toward `--force` for manual testing of new templates.
- Should the two built-in templates ship enabled by default or require the user to opt in by copying them from an examples directory? Lean toward shipping them in `docs/specs/recurring/` directly on `aigon init` — they're useful for any repo.

## Related

- Research: `research-36-weekly-background-maintenance-tasks` (findings informed the template approach)
- Replaces: `scheduled-maintenance-runner`, `weekly-dependency-vulnerability-sweep`, `weekly-docs-gap-scan` (deleted — their purpose is served by the two built-in templates)
- `lib/dashboard-server.js` — server startup wiring
- `docs/development_workflow.md` — new "Recurring Features" section
