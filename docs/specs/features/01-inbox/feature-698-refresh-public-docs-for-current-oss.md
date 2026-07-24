---
aigon_id: F698
complexity: high
set: docs-release-readiness
depends_on: [restore-antigravity-agent-reliability, harden-setup-wizard-contract]
---

# Feature: refresh-public-docs-for-current-oss

## Summary

Bring the public landing page and all 108 documentation pages into line with the Aigon
release that actually exists after F696 and F697. Replace live Gemini CLI/`gg` agent
instructions with Antigravity CLI/`ag`, correct the license, lifecycle, stable spec layout,
dashboard security, setup flow, deprecated Feedback workflow, command examples, and stale
visuals. Preserve the existing Aigon Pro product terminology and tier framing exactly as a
separate concern: F693–F695 (`pro-merge`) will remove/rewrite that material later.

## User Stories

- [ ] As a new user, I can install Aigon, choose a supported agent, run setup, create a
      feature, and understand its lifecycle without encountering obsolete commands or agents.
- [ ] As an existing user, public docs distinguish current behavior, compatibility history,
      deprecated aliases, and Pro-gated behavior without mixing them together.
- [ ] As a security-conscious operator, the dashboard access documentation matches the
      loopback-by-default server and explains the controlled non-loopback path.
- [ ] As a reader on desktop or mobile, screenshots and card descriptions match the current
      dashboard, including visible Peek/session behavior and compact card layout.
- [ ] As a maintainer, historical records remain historical; only live user-facing
      documentation and generated marketing/search metadata are rewritten.

## Acceptance Criteria

### Supported-agent truth

- [ ] The live user-facing surfaces under `site/content`, `site/public`, `site/app`,
      `site/components`, and `site/scripts` contain no instruction to install, select, launch,
      review with, or evaluate with `gg`/Gemini CLI.
- [ ] Replace those examples with Antigravity CLI (`ag`) only after F696's real lifecycle
      gate passes. Other examples use the active registry rather than hardcoding a provider
      where provider identity is irrelevant.
- [ ] “Gemini” may remain only when it names a model family used through Antigravity, or in
      an explicit historical/migration note. “Gemini CLI” and agent ID `gg` do not remain as
      current capabilities.
- [ ] Agent lists consistently reflect launchable agents and explain that deactivated agents
      remain only for historical telemetry.
- [ ] Landing metadata, Open Graph generation, `llms.txt`, `llms-full.txt`, comparison copy,
      configuration examples, command examples, tutorials, and image alt text follow the
      same agent contract.

### License and product facts

- [ ] The landing page and Pro page say Apache-2.0, matching `package.json` and the repository
      license; no live marketing/footer surface says MIT.
- [ ] Install and update commands use the release channel chosen by the maintainer and do
      not point at an older npm tag than the release being documented.
- [ ] Competitive claims have primary-source links or are softened, carry a last-verified
      date, and do not claim universal competitor capabilities without evidence.
- [ ] Pro benchmark copy does not promise machine-independent results or a fresh sweep on
      every release unless the release process proves those guarantees.

### Lifecycle and workflow truth

- [ ] Creation examples show the permanent `F<ID>` allocated by `feature-create`;
      prioritisation is lifecycle-only and never described as assigning/rekeying the ID.
- [ ] Examples use canonical signals such as `implementation-complete` and
      `research-complete`; `submitted` appears only in a clearly marked compatibility table.
- [ ] Completion points to `05-done`, and stable-layout documentation explains canonical
      specs in `00-specs` plus projected lifecycle views. Remove claims that every lifecycle
      transition is a Git file move/diff.
- [ ] Drive/Fleet descriptions do not claim every agent always runs in a worktree or under
      tmux; they use the current session-host and execution-mode contracts.
- [ ] Feedback is removed from the “three core workflows”/primary guide journey. The legacy
      guide and command pages state that creation is a no-op and direct new input to research
      with `origin: customer-feedback`.
- [ ] Workflow definitions and Fleet are classified according to current OSS behavior; only
      genuinely gated launch/capability surfaces carry the existing Pro marker.

### Setup and dashboard truth

- [ ] Getting Started, Setup Wizard, setup command reference, and clean-room material describe
      F697's real nine-step flow, resume/explicit-step behavior, conservative `--yes` defaults,
      terminal options, agent auth, seed behavior, and server persistence.
- [ ] This feature may correct facts inside the Pro step description but must not remove,
      reposition, rename, or harmonize Pro terminology, availability, or tier messaging.
- [ ] Dashboard docs state loopback binding by default. Non-loopback access documents the
      required shared secret/token and host allow-list; it never says `0.0.0.0` or LAN access
      is the default.
- [ ] Remove drag-and-drop claims unless the current UI supports them. Describe actions from
      server-owned valid actions and current card/session/Peek behavior.
- [ ] Replace obsolete budget-cache paths and legacy endpoint “for one release” claims with
      the current unified quota contract.

### Navigation, content, and visuals

- [ ] Repair the broken uninstall link by adding a current uninstall/remove guide or linking
      directly to the accurate `aigon remove` reference.
- [ ] Every MDX page has meaningful title/description frontmatter; the Pro installation page
      no longer appears as `guides/pro-installation` in machine-readable output.
- [ ] Resolve all eleven `PLACEHOLDER`/`TODO` markers in the five affected public pages.
- [ ] Recapture current dashboard/gallery images after the content pass. Review Cards,
      Pipeline, Monitor, setup, landing, and Pro surfaces at desktop and 390px mobile.
- [ ] Screenshots do not show retired agents, `Submitted`, obsolete Feedback tabs, stale card
      controls, or layouts that predate the compact contract cards.
- [ ] `/pro` serves its canonical page without an accidental temporary redirect to
      `/pro.html`. This is routing/SEO only; its product terminology remains unchanged.
- [ ] Sitemap modification dates are meaningful or omitted rather than reset for every page
      on each build.

## Validation

```bash
! rg -n '\bgg\b|Gemini CLI' site/content site/public site/app site/components site/scripts
! rg -n 'MIT License|Open source[^<\\n]*MIT' site/public site/app
! rg -n '0\\.0\\.0\\.0|binds.*local network' site/content site/public
! rg -n 'PLACEHOLDER|TODO|TBD' site/content
npm run build --prefix site
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
```

If a deliberately historical “Gemini CLI” reference remains, replace the zero-hit command
with an allowlisted checker that identifies the exact approved file and context.

## Pre-authorised

- May regenerate committed public screenshots and machine-readable documentation outputs.
- May skip full browser tests during prose-only iterations; desktop/mobile visual review and
  the deploy gate remain required before close.

## Technical Approach

Create a temporary facts checklist from the executable agent registry, workflow read model,
wizard step contract, dashboard security resolver, package metadata, and command handlers.
Update the reader journey in order: landing and Getting Started, concepts, guides, references,
then metadata/LLM/sitemap and visuals. This reduces repeated edits and keeps each page grounded
in an already-correct implementation.

Use registry- or command-derived examples where practical, but do not turn the prose into
generated boilerplate. Keep deprecated/historical material clearly separated from current
instructions. Use the dashboard gallery as the canonical visual-state source.

## Dependencies

- `restore-antigravity-agent-reliability` — docs must not advertise `ag` until it passes a
  real Aigon lifecycle.
- `harden-setup-wizard-contract` — setup docs must describe the fixed behavior, not the audit.

## Out of Scope

- Removing or merging `@senlabsai/aigon-pro`.
- Rewriting Aigon Pro availability, tier names, “coming soon”/beta terminology, activation,
  key, package, or capability framing. F693–F695 own that work.
- Editing historical specs, logs, evaluations, or old changelog entries to replace `gg`.
- Rewriting stored `gg` telemetry or attribution as `ag`.
- Implementing missing command-reference automation; F699 owns the lasting gate.

## Open Questions

- Which npm dist-tag will this release publish and therefore which command should the site show?
- Should the legacy Feedback guide remain navigable under a “Migration/Deprecated” separator
  or redirect to the research workflow?
- Which competitive claims remain valuable after requiring citations and verification dates?

## Related

- F696 and F697 — implementation facts this documentation consumes.
- F691 — release stabilisation and compact dashboard session controls.
- F693–F695 (`pro-merge`) — intentionally separate follow-up for all Pro terminology/removal.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 698" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-698" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-698)"/><path d="M 244 174 C 284 174, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-698)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-698)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#696</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">restore antigravity agent…</text><text x="36" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="24" y="132" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="36" y="156" font-size="14" font-weight="700" fill="#0f172a">#697</text><text x="36" y="178" font-size="13" font-weight="500" fill="#1f2937">harden setup wizard contr…</text><text x="36" y="198" font-size="12" fill="#475569">inbox</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#698</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh public docs for c…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
