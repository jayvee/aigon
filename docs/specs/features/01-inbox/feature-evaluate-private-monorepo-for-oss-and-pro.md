---
complexity: very-high
# agent: cc    # optional — id of the agent that owns this spec. Used as the
#              #   default reviewer for spec-revise cycles when the operator
#              #   does not pick one explicitly. Precedence at revision time:
#              #     event payload nextReviewerId > frontmatter agent:
#              #     > snapshot.authorAgentId > getDefaultAgent().
# research: 44 # optional — id (or list of ids) of the research topic that
#              #   spawned this feature. Stamped automatically by `research-eval`
#              #   on features it creates. Surfaced in the dashboard research
#              #   detail panel under Agent Log → FEATURES.
# planning_context: ~/.claude/plans/your-plan.md  # optional — path(s) to plan file(s)
#              #   generated during an interactive planning session (e.g. EnterPlanMode).
#              #   Content is injected into the agent's context at feature-do time and
#              #   copied into the implementation log at feature-start for durability.
#              #   Set this whenever you ran plan mode before writing the spec.
---

# Feature: Evaluate private monorepo for OSS and Pro

## Summary
Evaluate and, only if justified by the findings, implement a private monorepo source of truth for `aigon` OSS and `aigon-pro`, while preserving a clean public OSS package/repo that does not expose Pro implementation code. The goal is to reduce day-to-day friction from running two repos, local linking, version skew, and cross-repo feature work, without weakening the public/private boundary. This is intentionally marked `very-high` because the change affects development workflow, package layout, release/export safety, dashboard capability gating, command registration, tests, CI, docs, templates, and migration ownership.

## User Stories
- [ ] As the maintainer, I can work on OSS and Pro together from one local checkout without manual `npm link`, sibling repo path assumptions, or version skew.
- [ ] As the maintainer, I can run the dashboard locally with Pro enabled when the private package is present and with Pro hidden or stubbed when it is absent.
- [ ] As an OSS user, I can install and use the public Aigon package without seeing private Pro implementation files, private docs, or broken imports.
- [ ] As a release operator, I can publish/export OSS confidently because automated checks prove Pro code, templates, docs, and dependencies did not leak.
- [ ] As a Pro user, I can keep using Pro commands, dashboard tabs, routes, migrations, backup/sync/profile/vault flows, schedules, and recurring workflows through explicit Pro registration.
- [ ] As a future implementing agent, I have a clear escape hatch: if the complexity and leakage risk exceed the benefits, this feature can produce a written recommendation to keep separate repos and improve local linking instead.

## Acceptance Criteria
- [ ] A design decision document compares three options: keep separate repos, private monorepo with public OSS export, and single public repo with runtime Pro hiding. The recommendation must explicitly address source-code visibility, not just UI visibility.
- [ ] If the monorepo path is chosen, the repository has a workspace layout equivalent to `packages/aigon` for OSS and `packages/aigon-pro` for private Pro, with a root workspace configuration and scripts for local dev/test.
- [ ] OSS package code still runs without `@aigon/pro` installed. Pro commands either stay hidden or print the standard Pro notice when invoked without Pro.
- [ ] Pro functionality registers through `lib/pro-bridge.js` or a deliberately extended bridge API. Core OSS code must not import Pro implementation modules directly.
- [ ] Dashboard capabilities are server-owned. The frontend renders Pro tabs/actions from server-provided capabilities instead of hardcoded assumptions.
- [ ] Pro dashboard/API routes are registered only when Pro is installed/enabled. OSS-only route behavior is deterministic and tested.
- [ ] Command registration supports OSS stubs and Pro-provided real handlers for Pro-owned commands such as backup/sync/profile/vault, schedules, recurring workflows, and agent-launch.
- [ ] Templates and slash commands are split so OSS install paths receive only OSS templates, while Pro-enabled installs can add Pro templates without polluting public exports.
- [ ] Migrations are split so `aigon doctor --fix` always runs OSS migrations and runs Pro migrations only when Pro is available.
- [ ] Config is namespaced so OSS tolerates existing Pro config but does not require it.
- [ ] Tests cover OSS-only, Pro-only, and integrated OSS+Pro behavior where applicable.
- [ ] CI has an OSS export verification gate that fails on private file leakage, direct Pro implementation imports, Pro-only docs/templates in the OSS artifact, or invalid `npm pack` contents.
- [ ] Release documentation explains how OSS and Pro versions are managed. The spec should prefer locked versions unless implementation proves independent versions are materially better.
- [ ] The final implementation or decision leaves documented rollback instructions.

## Validation
```bash
node -c aigon-cli.js
npm test
npm run verify:oss-export
npm run test:oss
npm run test:pro
npm run test:integration
```

## Pre-authorised
<!-- Standing orders the agent may enact without stopping to ask.
     Each line is a single bounded permission. The agent cites the matching line
     in a commit footer `Pre-authorised-by: <slug>` for auditability.
     The first line below is a project-wide default — keep it unless the feature
     explicitly demands Playwright runs mid-iterate. Add or remove other lines
     per feature.
     Example extras:
       - May raise `scripts/check-test-budget.sh` CEILING by up to +40 LOC if regression tests require it.
-->
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach
Start with discovery, not file moves. The first deliverable is a concrete migration plan with costs, risks, and a go/no-go recommendation. If implementation proceeds, prefer a private monorepo as the source of truth:

```text
aigon/
  packages/
    aigon/          # public OSS package/repo export
      aigon-cli.js
      lib/
      templates/
      docs/
      package.json

    aigon-pro/      # private Pro package
      lib/
      dashboard/
      migrations/
      templates/
      package.json

  tooling/
    verify-oss-export.js
    sync-oss-export.js
    release.js

  package.json      # workspace root
```

Key operations to change:

- Local dev setup: replace sibling repos plus manual linking with workspace install, shared scripts, and one dev dashboard that can run with or without Pro.
- Pro loading: keep the existing `lib/pro.js` / `lib/pro-bridge.js` shape, but make Pro availability explicit and optional. OSS must degrade cleanly when Pro is unavailable.
- CLI command registration: keep OSS stubs for Pro-owned verbs, then allow Pro to replace/register real handlers through the bridge.
- Dashboard capability gating: expose server-owned capability flags such as `proInstalled`, `backupSync`, `schedules`, and `recurring`; render tabs/actions from that payload.
- Dashboard routes: keep OSS route aggregation public; allow Pro to contribute private routes during initialization.
- Shared helper boundary: define the helper/API surface that Pro may use instead of allowing random imports into `packages/aigon/lib/*`.
- Imports and paths: eliminate sibling-repo path assumptions and avoid direct `../../aigon/...` style imports from Pro.
- Tests: keep OSS tests runnable without Pro, add integrated tests for Pro-enabled behavior, and add export tests.
- CI: run private monorepo CI across all packages, public OSS CI against the exported OSS package, and release/export CI against `npm pack` contents.
- Release process: decide locked versions versus independent versions. Prefer locked versions for lower compatibility overhead unless a clear Pro release need emerges.
- Public OSS export: add a repeatable export script that copies only `packages/aigon` to the public repo/package and fails on leakage.
- Docs: split OSS-visible docs from Pro-private docs; public docs may mention Pro but must not include implementation details.
- Templates and agent commands: keep OSS templates in the OSS package and Pro-only templates in the Pro package; install only what the active capability set permits.
- Migrations: run OSS migrations always; run Pro migrations only when Pro is present.
- Config: namespace Pro config under a `pro` key and ensure OSS ignores unknown Pro config safely.

Important constraints:

- Hiding Pro in the OSS UI is possible. Hiding Pro source code is not possible if the Pro implementation lives in a public repo.
- `dashboard-server.js` must not absorb Pro business logic. Pro should register through route/capability hooks.
- Dashboard/frontend code should not parse Pro availability from package files directly; the server owns the read model.
- The public OSS artifact is the product boundary. Treat `verify:oss-export` as mandatory, not a convenience script.

Expected benefits:

- One working copy for cross-cutting OSS and Pro changes.
- No local development version skew.
- Atomic refactors across workflow-core, dashboard, commands, config, migrations, and Pro.
- Stronger test matrix: OSS alone, Pro alone, integrated OSS+Pro.
- Simpler local debugging with one dev server.
- Clearer Pro boundary through a bridge/API.
- Safer public releases through automated export verification.
- Faster feature work where functionality spans OSS and Pro.

Known risks:

- Accidental Pro leakage into the public package or repo.
- Overfitting OSS internals to Pro needs.
- Larger repo and release machinery.
- More complex CI and packaging.
- Potential churn in imports, tests, docs, and developer tooling.
- The migration may take longer than improving the current two-repo workflow.

Suggested implementation phases:

1. Write the decision document and inventory current OSS/Pro coupling points.
2. Design the Pro bridge/helper contract and capability payload.
3. Prototype workspace layout on a branch without changing public release flow.
4. Add OSS export verification before moving sensitive code.
5. Move or mirror Pro package into the private workspace.
6. Convert command, route, template, migration, and config registration to bridge-owned capability registration.
7. Add the OSS-only, Pro-enabled, and export test matrix.
8. Dry-run release/export from a clean checkout.
9. Decide whether to complete the migration or stop with documented improvements to the separate-repo workflow.

## Dependencies
- Access to the private `aigon-pro` repository/package.
- Agreement on whether the source of truth becomes a private monorepo or remains split.
- A public OSS export/publish target for dry runs.
- CI credentials for both public OSS and private Pro package publishing if implementation proceeds.

## Out of Scope
- Changing Pro product scope or deciding which features are paid.
- Publishing Pro source code publicly.
- Rewriting workflow-core or lifecycle states for their own sake.
- Building new Pro features during the migration.
- Changing agent model defaults or spec recommendation behavior.
- Replacing the existing dashboard architecture beyond the capability/route registration needed for this boundary.

## Open Questions
- Should `aigon` and `aigon-pro` use locked versions, or should Pro version independently?
- Should public OSS be exported to the existing public repo, or should `packages/aigon` itself become publishable without a mirror?
- Should OSS help output hide Pro commands entirely, or show a concise disabled Pro section?
- What is the minimum helper/API surface Pro needs from OSS?
- Which Pro templates, commands, migrations, and dashboard routes currently depend on installed paths rather than package-owned paths?
- Can `npm pack` plus export verification fully prevent leakage, or do we also need a public-repo mirror check?
- Is the current two-repo pain mostly tooling/linking, and therefore solvable with a smaller local-dev feature?

## Related
- Private package boundary: `lib/pro.js`, `lib/pro-bridge.js`
- Pro-delegating OSS stubs: `lib/commands/recurring.js`, `lib/commands/schedule.js`, `lib/commands/agent-launch.js`
- Dashboard route aggregation: `lib/dashboard-routes.js`, `lib/dashboard-routes/*`
- Dashboard server capability/read model surfaces: `lib/dashboard-server.js`, `lib/dashboard-status-collector.js`
- Template installation boundary: `templates/generic/commands/`, `templates/agents/*.json`
