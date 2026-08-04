---
aigon_id: F745
complexity: low
depends_on: [743]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-08-04T14:30:30.365Z", actor: "cli/feature-prioritise" }
---

# Feature: Document GitHub Copilot CLI agent

## Summary

Follow F743's GitHub Copilot CLI (`cp`) onboarding with a focused documentation and discoverability pass. Update Aigon's public documentation, repository-facing help, and homepage/SEO copy wherever they present an exhaustive supported-agent roster or describe an agent capability affected by Copilot. The result should explain installation, authentication, Agent Skills invocation, Auto model selection, optional named models, and the current telemetry limitations without changing the implementation delivered by F743.

## User Stories

- [ ] As a prospective user, I can see from Aigon's README and website that GitHub Copilot CLI is supported and understand why I might use it.
- [ ] As a Copilot subscriber, I can install the CLI, authenticate it, install Aigon's `cp` integration, and start a task without having to infer the agent code or invocation syntax.
- [ ] As an operator, I understand that Auto is the safe default, named-model availability depends on my Copilot plan and organization policy, and Copilot does not provide Aigon transcript, token, cost, quota, or resume telemetry in this release.
- [ ] As a maintainer, exhaustive supported-agent lists remain consistent across the README, public docs, help examples, homepage, and machine-readable/SEO descriptions.

## Acceptance Criteria

- [ ] Public documentation identifies GitHub Copilot CLI as the `cp` agent, using the `copilot` binary and Agent Skills under `.agents/skills/` with explicit `/aigon-<command>` invocation.
- [ ] The setup path documents `brew install --cask copilot-cli` and `npm install -g @github/copilot` (Node.js 22+ for npm), followed by `copilot login` and `aigon install-agent cp`.
- [ ] Authentication guidance states that an active Copilot plan is required and organization-managed accounts may need the Copilot CLI policy enabled; it never asks users to expose stored credentials.
- [ ] Model guidance presents `Auto` as the recommended default and says the Aigon picker also offers reviewed named GPT, Claude, Gemini, and MAI models, while access varies by plan, organization policy, and the installed CLI catalog. It recommends returning to Auto when a named model is rejected rather than promising universal availability.
- [ ] Product positioning describes Copilot as one GitHub Copilot entitlement that can route among model families. It does not count those routed families as independent subscriptions or quota pools and does not imply that a `cp` session is provider-independent from another `cp` session.
- [ ] Capability-specific documentation states that `cp` is launchable in Drive and Fleet workflows but is not a default Fleet agent and has no Aigon transcript, token, cost, quota, or resume telemetry in the first release.
- [ ] `README.md` is updated wherever it has an exhaustive/current agent roster: hero copy, interaction surfaces, supported-agent list, bring-your-own-subscriptions copy, quick-start install hints, usage copy, and the Agents reference link.
- [ ] Repository-facing setup/help surfaces that enumerate installable agents are updated, including `CONTRIBUTING.md`, `templates/help.txt`, and relevant package metadata/keywords.
- [ ] The public site is updated across all three requested surfaces:
  - [ ] documentation/reference: the Agents reference, Getting Started, `install-agent`, setup wizard, configuration/permissions, file structure, command invocation/opening references, and capability guides whose exhaustive telemetry or quota claims would otherwise be false;
  - [ ] product explanation: docs landing and comparison copy, with accurate subscription/quota wording;
  - [ ] marketing/discoverability: homepage title/hero copy and appropriate demos, application metadata, and the `llms.txt` and `llms-full.txt` routes.
- [ ] Scenario-specific examples and screenshots/GIFs may continue to show a subset of agents when they are clearly illustrative. Text, metadata, and alt text are corrected where needed, but screenshots/GIFs are not regenerated and existing examples are not mechanically expanded merely to include `cp`.
- [ ] Generated Pagefind output under `site/public/_pagefind/` is not hand-edited; it is regenerated only through the documented site build.
- [ ] A focused source audit finds no remaining exhaustive supported-agent roster that omits `cp`, while deliberately illustrative examples are left readable and internally consistent.
- [ ] All links, commands, identifiers, and capability claims agree with the final F743 registry template and generated GitHub Copilot agent guide.

## Validation

```bash
npm run docs:check
npm run build --prefix site
node scripts/check-template-leaks.js
git diff --check
```

## Pre-authorised

## Technical Approach

1. Treat F743's merged `templates/agents/cp.json`, generated Copilot guide, and focused tests as the implementation source of truth. Do not copy the drafting-time model list from F743 if the final registry differs.
2. Audit source files—not generated search output—for exhaustive agent rosters and capability claims. Start with `README.md`, `CONTRIBUTING.md`, `templates/help.txt`, `package.json`, `site/content/`, `site/app/`, and `site/public/home.html`.
3. Add `cp` to exhaustive/current rosters and setup commands. Leave examples that intentionally demonstrate a particular pair or workflow unchanged unless their prose claims to cover every supported agent.
4. Give the Agents reference the detailed operational guidance: installation, login, `aigon install-agent cp`, Agent Skills command form, Auto and named models, organization-policy caveat, `--allow-all` trust implications, and unavailable telemetry/resume capabilities.
5. Keep higher-level README and marketing copy concise and link users to the Agents reference for detail. Describe multi-model routing as part of the Copilot entitlement, not as multiple independent provider quotas.
6. Correct telemetry and quota documentation where broad statements such as "every agent" would become inaccurate. Prefer an explicit capability matrix or caveat over implying data that F743 does not collect.
7. Run the source documentation checks and a production site build. Review the changed homepage/docs at desktop and 390px only when the copy alters wrapping or layout materially; no new screenshot assets are required.

## Dependencies

- depends_on: onboard-github-copilot-cli
- F743 must be merged so its final registry entry and generated guide are available as the documentation authority.

## Out of Scope

- Changes to `templates/agents/cp.json`, Copilot launch behavior, model registration, installation generation, authentication checks, or lifecycle/session behavior delivered by F743.
- Adding Copilot transcript parsing, token/cost accounting, quota polling, provider-session binding, or resume support.
- Making `cp` a default Fleet agent or supplying benchmark scores.
- Regenerating screenshots, GIFs, or social-card artwork that remain valid illustrative examples.
- Rewriting unrelated agent-specific tutorials or expanding every two-agent example into a complete roster.
- Hand-editing generated Pagefind artifacts.

## Open Questions

- None. Scope covers public docs/help, README and agent references, and homepage/SEO marketing; visual changes are limited to copy, metadata, and alt text.

## Related

- Prior work: F743 — onboard-github-copilot-cli
- `docs/specs/features/03-in-progress/feature-743-onboard-github-copilot-cli.md`
- `docs/adding-agents.md`
- `site/content/reference/agents.mdx`
- GitHub Copilot CLI documentation: https://docs.github.com/en/copilot/concepts/agents/copilot-cli/about-copilot-cli
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 745" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-745" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-745)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#743</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">onboard github copilot cli</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#745</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">document github copilot a…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
