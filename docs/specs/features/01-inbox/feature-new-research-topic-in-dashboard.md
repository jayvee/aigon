---
complexity: medium
---

# Feature: new-research-topic-in-dashboard

## Summary

The dashboard has a "+ New Feature" button in the feature pipeline's inbox column that opens a create modal with name, description, and optional agent picker — selecting an agent spawns an interactive drafting session so the user can refine the spec conversationally. Research has no equivalent: the research column has no create button, and `aigon research-create` lacks the `--agent` flag that powers interactive drafting on the feature side. This feature adds the missing research path so users can create and agent-draft a research topic without leaving the dashboard.

## User Stories
- [ ] As a user on the research Kanban view, I can click "+ New Research" in the inbox column and see a create modal matching the feature one (name, description, agent picker).
- [ ] As a user, I can submit the research create modal with an agent selected and get dropped into an interactive drafting session that iterates on `docs/specs/research-topics/01-inbox/research-<slug>.md`.
- [ ] As a CLI user, I can run `aigon research-create <name> --agent <id> [--description "..."]` and get the same agent-assisted drafting flow that `feature-create --agent` already provides.

## Acceptance Criteria
- [ ] Dashboard renders a "+ New Research" button on the research pipeline's inbox column (mirroring the feature button at `templates/dashboard/index.html:223`).
- [ ] The create modal (`#create-modal`) reuses the existing markup and JS in `templates/dashboard/js/pipeline.js` — entity type is passed through so the same modal serves both features and research without duplication.
- [ ] `POST /api/spec/create` with `type: 'research'` continues to work (already supported in `lib/dashboard-routes.js:1103-1154`); the dashboard flow hits it.
- [ ] When an agent is selected, the dashboard opens an agent session (parallel to the feature flow via `POST /api/session/ask` or equivalent) pointed at the newly created research spec.
- [ ] `aigon research-create` accepts `--agent <id>` and `--description <text>`, matching `feature-create` flag parity (see `lib/commands/feature.js:317-386`).
- [ ] Agent-assisted research drafting works end-to-end: a new module `lib/research-draft.js` (mirroring `lib/feature-draft.js`) spawns the agent with a research-appropriate prompt, validates agent CLI availability, and reports whether the spec was edited.
- [ ] `lib/entity.js entityCreate()` routes to the research drafting module when `entityType === 'research'` and `--agent` is set (currently feature-only at lines 150-155).
- [ ] No regression in the existing feature create flow — `npm test && MOCK_DELAY=fast npm run test:ui && bash scripts/check-test-budget.sh` passes.
- [ ] Dashboard change is verified with a Playwright screenshot per the hot rules.

## Validation
```bash
node -c aigon-cli.js
npm test
MOCK_DELAY=fast npm run test:ui
bash scripts/check-test-budget.sh
```

## Pre-authorised

## Technical Approach

Mirror the feature-create path end-to-end rather than forking a parallel implementation. Three layers to touch:

1. **CLI parity** — extend `aigon research-create` with `--agent` and `--description` flags. The shared factory in `lib/commands/entity-commands.js:307` likely needs a research-specific override, or `entityCreate()` in `lib/entity.js` can be generalised so the drafting-agent branch runs for both entity types.

2. **Drafting module** — add `lib/research-draft.js` mirroring `lib/feature-draft.js:80-139`. The prompt differs: research drafting should steer the agent toward framing a research question, defining success criteria for the investigation, and enumerating candidate angles — not toward implementation acceptance criteria. Keep the hash-check + next-step guidance pattern.

3. **Dashboard** — add a "+ New Research" button to the research inbox column in `templates/dashboard/index.html`. Generalise `submitCreateModal()` in `templates/dashboard/js/pipeline.js:148-227` so it carries an entity type through the modal and the submit handler. The `/api/spec/create` endpoint already supports `type: 'research'`, so no new server route is strictly required — but the agent-handoff step (opening the interactive session) needs to work for research paths too; verify `/api/session/ask` or the equivalent handles a research spec path.

Use `Skill(frontend-design)` before touching the dashboard markup/CSS per the mandatory rule.

## Dependencies
-

## Out of Scope
- Redesigning the create modal — reuse the existing one.
- Changing research lifecycle states or Kanban columns beyond adding the inbox-column button.
- Adding agent drafting to `feedback-create` (that's a separate follow-up if wanted).
- Restructuring `docs/specs/research-topics/` folder layout.

## Open Questions
- Should the agent-drafting prompt for research live alongside the feature one (shared template with entity-type variables) or be a fully separate prompt file? Leaning shared-with-variables to keep them in sync.
- Does the dashboard currently expose the research Kanban pipeline view at all, or is it a list-only view today? If list-only, the "+ New Research" button placement needs to be designed rather than copied 1:1 from features.

## Related
- Research:
- Set:
- Prior features in set:
