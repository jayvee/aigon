---
complexity: medium
recommended_models:
  cc: { model: null, effort: null }
  cx: { model: null, effort: null }
  gg: { model: null, effort: null }
  cu: { model: null, effort: null }
  op: { model: null, effort: null }
---

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
- [ ] Templates live in `docs/specs/recurring/`; they are input templates only and must not be included by kanban / dashboard feature discovery
- [ ] Template frontmatter supports: `schedule: weekly` (only `weekly` in v1), `name_pattern: <string>` using `{{YYYY-WW}}` (ISO year + week number) for the instantiated feature name
- [ ] Template frontmatter also supports a stable `recurring_slug:`; every instantiated feature carries that value in its own frontmatter so recurring-instance detection does not depend on filenames or titles
- [ ] Template body is a standard feature spec (Summary, User Stories, Acceptance Criteria, etc.) and is cloned into the new inbox spec with the rendered feature title; the instance may add only the rendered `name`, `recurring_slug`, and machine-generated provenance fields needed for dedupe/debugging
- [ ] Missing or malformed `schedule` frontmatter skips the file with a server log warning
- [ ] Missing `name_pattern` or `recurring_slug`, duplicate `recurring_slug` values across templates, or unsupported placeholders skip that template with a warning and do not create partial specs

### Scheduling logic
- [ ] Check runs once immediately during server startup and then every 24 hours from a dedicated scheduler; it must remain independent of the dashboard poll loop and must not gate server boot if a check fails
- [ ] "Due" means the current ISO week (Mon-Sun, ISO 8601) has no open instance for that `recurring_slug` across `01-inbox/`, `02-backlog/`, `03-in-progress/`, and `04-in-evaluation/`; `05-done/` and `06-paused/` do not block creation
- [ ] When due, the shared recurring helper clones the template into `docs/specs/features/01-inbox/`, renders `name_pattern`, and then invokes the existing feature-prioritise implementation in-process so ID assignment and stage movement keep using the canonical write path
- [ ] If inbox creation or prioritisation fails, the run logs the error, leaves no duplicate backlog item, and does not mark the template as created for that week
- [ ] Concurrent triggers (`aigon recurring-run` while the background check is running, or rapid server restarts) must not create duplicate instances for the same `recurring_slug` and ISO week
- [ ] `.aigon/recurring-state.json` is optional bookkeeping for last successful creation/check metadata only; open feature specs remain the authority for dedupe and due/not-due decisions
- [ ] Server log records each check: templates found, how many due, how many created, how many skipped (with reason)

### Manual trigger
- [ ] `aigon recurring-run` performs the same shared due-check and creation path on demand, prints a per-template summary, and exits successfully when nothing is due
- [ ] `aigon recurring-list` shows each template's `recurring_slug`, schedule, last successful creation week (if any), and current due/not-due status derived from the same detection logic

### Built-in templates
- [ ] `docs/specs/recurring/weekly-dep-sweep.md` — weekly feature that runs `npm audit` and `npm outdated`, writes findings to `docs/reports/dep-sweep-{{YYYY-WW}}.md`, and closes. Agent implements and closes; no eval step needed
- [ ] `docs/specs/recurring/weekly-docs-gap-scan.md` — weekly feature that diffs `lib/` and `templates/` changes since the last authoritative-doc commit (`AGENTS.md`, `docs/architecture.md`, `docs/development_workflow.md`), writes gap report to `docs/reports/docs-gap-{{YYYY-WW}}.md`, and closes

### Documentation
- [ ] `docs/development_workflow.md` gets a "Recurring Features" section explaining the template format, `docs/specs/recurring/`, the weekly ISO cadence, and how to add a custom template
- [ ] `AGENTS.md` updated to mention `docs/specs/recurring/` in the directory map

## Validation

```bash
node -c lib/dashboard-server.js
node -c lib/recurring.js
node -c lib/commands/misc.js # or lib/commands/recurring.js if the commands are split out
aigon recurring-list
aigon recurring-run
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
        if (hasOpenInstance(repoPath, template.recurringSlug, currentWeek)) {
            log(`Skipping ${template.recurringSlug} - open instance exists`);
            continue;
        }
        if (state[template.recurringSlug]?.lastWeek === currentWeek) {
            log(`Skipping ${template.recurringSlug} - already created this week`);
            continue;
        }
        const featureName = renderPattern(template.namePattern, currentWeek);
        createFeatureFromTemplate(repoPath, template, featureName);
        prioritiseFeature(repoPath, featureName);
        state[template.recurringSlug] = { lastWeek: currentWeek };
        log(`Created and prioritised: ${featureName}`);
    }
    writeRecurringState(repoPath, state);
}
```

### Open instance check

Use the instantiated spec frontmatter `recurring_slug:` as the match key when scanning `01-inbox/`, `02-backlog/`, `03-in-progress/`, and `04-in-evaluation/`. Done (`05-done/`) and paused (`06-paused/`) are explicitly excluded so a closed or abandoned instance does not block the new one.

### Server wiring (`lib/dashboard-server.js`)

```js
const { checkRecurringFeatures } = require('./recurring');

// In startServer(), after the poll loop is started:
checkRecurringFeatures(repoPath);
setInterval(() => checkRecurringFeatures(repoPath), 24 * 60 * 60 * 1000).unref();
```

No interaction with `pollStatus` or `scheduleNextPoll`. The scheduler should call a shared library function; it must not shell out to the `aigon recurring-run` CLI.

### CLI commands (`lib/commands/misc.js` or new `lib/commands/recurring.js`)

- `aigon recurring-run` calls the shared recurring helper and prints a summary
- `aigon recurring-list` prints each template with `recurring_slug`, schedule, last week created, and due/not-due status for the current week

### State file (`.aigon/recurring-state.json`, gitignored)

```json
{
  "weekly-dep-sweep": { "lastWeek": "2026-W17" },
  "weekly-docs-gap-scan": { "lastWeek": "2026-W17" }
}
```

Simple enough that no migration is needed if the file is absent — treat missing as "never run." This file is an optimization for observability, not the source of truth for dedupe.

## Dependencies

- None beyond existing feature-spec and prioritisation helpers; the implementation should reuse the canonical prioritise write path rather than inventing a second ID-assignment flow

## Out of Scope

- `schedule: daily` or `schedule: monthly` (v1 is weekly only; the schedule field is designed for extension)
- Dashboard UI for managing recurring templates (edit, disable, force-run) — CLI is enough for v1
- Cross-repo recurring features — each repo manages its own `docs/specs/recurring/`
- Autonomous execution of the instantiated feature — user still decides when to start it
- Email or push notifications when a new recurring feature is created

## Open Questions

- Should `recurring-run` also support `--force` for fixture-style testing, or is a no-op-with-summary enough for v1? The base command behavior should stay non-destructive and dedupe-respecting.
- Should the two built-in templates ship enabled by default or require the user to opt in by copying them from an examples directory? Lean toward shipping them in `docs/specs/recurring/` directly on `aigon init` — they're useful for any repo.

## Related

- Research: `research-36-weekly-background-maintenance-tasks` (findings informed the template approach)
- Replaces: `scheduled-maintenance-runner`, `weekly-dependency-vulnerability-sweep`, `weekly-docs-gap-scan` (deleted — their purpose is served by the two built-in templates)
- `lib/dashboard-server.js` — server startup wiring
- `docs/development_workflow.md` — new "Recurring Features" section
