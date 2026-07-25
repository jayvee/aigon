---
aigon_id: F698
complexity: high
set: docs-release-readiness
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T00:22:10.827Z", actor: "cli/feature-prioritise" }
---

# Feature: refresh-public-docs-for-current-oss

## Summary

Bring the public landing page and all 108 documentation pages into line with the Aigon
release that actually exists after F696. Commit `bbf64b21c` has already performed
the broad live Gemini CLI/`gg` → Antigravity CLI/`ag` naming pass; treat that commit as the
baseline to verify, not work to repeat. Correct inaccurate or mechanical substitutions
(especially authentication, subscription, and quota claims), then address the remaining
license, lifecycle, stable spec layout, dashboard security, deprecated Feedback workflow,
command examples, navigation, and stale visuals. F697 independently owns the setup wizard
and its dedicated public setup documentation. Preserve the existing Aigon Pro product
terminology and tier framing exactly as a separate concern: F693–F695 (`pro-merge`) will
remove/rewrite that material later.

## User Stories

- [ ] As a new user, I can install Aigon, choose a supported agent, create a feature, and
      understand its lifecycle without encountering obsolete commands or agents.
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

> **Spec review — read before ticking these.** The naming pass in `bbf64b21c` already landed:
> `rg '\bgg\b|Gemini CLI' site/content site/public site/app site/components site/scripts`
> returns **zero hits today** (the only match anywhere is vendored `_pagefind/pagefind-ui.js`).
> So the first two criteria below are already green and are **verification, not work**. The
> criteria that still carry real work are the authentication, subscription, and quota ones —
> and a `\bgg\b` grep cannot see any of them. Do not treat a passing grep as evidence that
> this section is done.

- [ ] Audit the complete `bbf64b21c` documentation diff against the active agent registry and
      F696 implementation log. Preserve correct replacements and fix incorrect mechanical
      substitutions rather than repeating the migration wholesale.
- [ ] *(already green — confirm only)* The live user-facing surfaces under `site/content`,
      `site/public`, `site/app`, `site/components`, and `site/scripts` contain no instruction to
      install, select, launch, review with, or evaluate with `gg`/Gemini CLI.
- [ ] **Positive assertion, since the grep cannot cover it:** enumerate every surviving
      Antigravity/Gemini mention (24 files at review time) and record for each one whether it is
      (a) a correct `ag`/Antigravity CLI reference, (b) a legitimate Gemini *model-family* name,
      (c) an explicit historical/migration note, or (d) a claim to fix. Land that classification
      in the implementation log so the F699 checker inherits an allowlist rather than guessing.
- [ ] Antigravity examples use CLI/agent ID `ag` only after F696 is merged and closed. Other
      examples use the active registry rather than hardcoding a provider where provider
      identity is irrelevant.
- [ ] Antigravity terminology distinguishes the Antigravity product/CLI, official interactive
      Google sign-in, and Gemini model names. Public copy does not invent an “Antigravity
      key”, API-key/env-token authentication, headless support, or a subscription name not
      established by the supported installation.
- [ ] Quota and failover copy matches the executable registry: Aigon may detect Antigravity
      exhaustion from a running session, but does not claim the periodic quota poller actively
      probes Antigravity unless a documented non-interactive quota source has been implemented.
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
- [ ] Default install and update commands use `@senlabsai/aigon@latest`. This release is a
      stable bare-semver release, which `scripts/publish.js`/`scripts/ship.js` route to the
      `latest` dist-tag; `@next` appears only in an explicitly labelled prerelease-channel note.
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

### Dashboard truth

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
      Pipeline, Monitor, landing, and Pro surfaces at desktop and 390px mobile. F697 owns
      setup-specific screenshots.
- [ ] Screenshots do not show retired agents, `Submitted`, obsolete Feedback tabs, stale card
      controls, or layouts that predate the compact contract cards.
- [ ] `/pro` serves its canonical page without an accidental temporary redirect to
      `/pro.html`. This is routing/SEO only; its product terminology remains unchanged.
- [ ] Sitemap modification dates are meaningful or omitted rather than reset for every page
      on each build.

## Validation

Three of these were over-escaped (`\\.` and `\\n` inside single quotes are literal backslashes
to `rg`, so the patterns did not match what the author intended). Corrected:

```bash
# Regression guards — these must stay at zero hits.
! rg -n '\bgg\b|Gemini CLI' site/content site/public site/app site/components site/scripts
! rg -n 'MIT License|Open source[^<\n]*MIT' site/public site/app
! rg -n '0\.0\.0\.0|binds.*local network' site/content site/public
! rg -n 'PLACEHOLDER|TODO|TBD' site/content

# Positive checks — a zero-hit grep cannot prove these.
rg -n 'Apache-2.0' site/public/home.html site/public/pro.html   # must hit
test -f site/content/guides/uninstalling-aigon.mdx              # or the link is retargeted
curl -sI http://localhost:3600/pro | head -1                    # 200, not 307/308

npm run build --prefix site
node tests/unit/dashboard-card-gallery.test.js
npm run test:gallery
```

The first grep **already passes** — it is a regression guard, not a completion signal (see the
note in Supported-agent truth). If a deliberately historical "Gemini CLI" reference is
introduced, replace that command with an allowlisted checker naming the exact approved file
and context, and hand the allowlist to F699.

## Pre-authorised

- May regenerate committed public screenshots and machine-readable documentation outputs.
- May skip full browser tests during prose-only iterations; desktop/mobile visual review and
  the deploy gate remain required before close.

## Technical Approach

Start with a focused review of `bbf64b21c`: classify each changed statement as a correct
agent rename, a model-family mention, or a claim requiring correction. Then create a temporary
facts checklist from the executable agent registry, F696 implementation log, workflow read
model, dashboard security resolver, package metadata, and command handlers. Update the
remaining reader journey in order: landing and the non-setup parts of Getting Started,
concepts, guides, references, then metadata/LLM/sitemap and visuals. Do not rewrite the
setup-owned passages or dedicated setup pages assigned to F697. This reduces repeated edits
and keeps each page grounded in an already-correct implementation.

Use registry- or command-derived examples where practical, but do not turn the prose into
generated boilerplate. Keep deprecated/historical material clearly separated from current
instructions. Use the dashboard gallery as the canonical visual-state source.

### Verified defect anchors (added by spec review)

Every factual claim in this spec was confirmed against the tree at `bbf64b21c`. Page counts and
locations are exact as of review, so start here instead of re-hunting:

| Claim | Confirmed at |
|---|---|
| 108 documentation pages | `find site/content -name '*.md*'` → 108 |
| MIT on live marketing | `site/public/home.html:83` (hero meta), `:669` (footer), `site/public/pro.html:430` — while `package.json` says Apache-2.0 |
| `0.0.0.0` claim is wrong | `site/content/guides/dashboard.mdx:300`, `site/content/reference/commands/infra/server.mdx:87`. The **code is already correct** — `lib/dashboard-security.js:18` sets `DEFAULT_HOST = '127.0.0.1'` (F672). This is a docs-only fix; do not "fix" the server. |
| 11 placeholders across 5 pages | `guides/dashboard.mdx` ×6 (`:62,72,76,85,93,225`), `guides/agent-matrix.mdx` ×2 (`:32,88`), `guides/security-scanning.mdx:60`, `guides/feature-sets-autonomous.mdx:16`, `reference/commands/feature/feature-code-review.mdx:47` |
| Broken uninstall link | `reference/commands/setup/remove.mdx:49` → `/docs/guides/uninstalling-aigon`; no such file exists under `site/content` |
| `/pro` double redirect | Both `site/next.config.mjs:39` (rewrite → `/pro.html`) **and** `site/app/pro/page.tsx:4` (`redirect("/pro.html")`). Two mechanisms for one route — resolving this means deleting one, not editing both. |

## Dependencies

- `restore-antigravity-agent-reliability` — **satisfied.** F696 is closed (`05-done`) and
  `139c0ae68`/`bbf64b21c` are on `main`; no active dependency remains.
- F697 runs in parallel and owns setup implementation plus the setup-specific docs/passages.
  This feature deliberately keeps the broader content baseline as one independently reviewable
  unit instead of creating another feature, while removing the false whole-feature dependency.
- F699 depends on both F697 and F698 and therefore cannot lock the site baseline until both
  parallel branches are complete.

## Out of Scope

- Removing or merging `@senlabsai/aigon-pro`.
- Rewriting Aigon Pro availability, tier names, “coming soon”/beta terminology, activation,
  key, package, or capability framing. F693–F695 own that work.
- Editing historical specs, logs, evaluations, or old changelog entries to replace `gg`.
- Rewriting stored `gg` telemetry or attribution as `ag`.
- Implementing missing command-reference automation; F699 owns the lasting gate.
- Rewriting Setup Wizard, setup-command reference, clean-room setup material, or the
  setup-specific passages/screenshots in Getting Started; F697 owns those facts.

## Decisions

- Publish/document the stable channel: default commands use `@latest`; `@next` is only an
  explicitly labelled prerelease option.
- Keep the legacy Feedback guide navigable under a “Migration/Deprecated” separator. It is a
  compatibility aid, not part of the primary journey.
- Keep a competitive claim only when a current primary source supports it and a
  last-verified date is useful; otherwise soften or remove it.
- Keep this as one high-complexity content-baseline feature. Setup docs moved to F697, which
  removes the unnecessary dependency and makes F697/F698 safely parallel at set level.

## Related

- F696 — completed Antigravity implementation facts this documentation consumes.
- F697 — parallel owner of the setup wizard and setup-specific public documentation.
- Commits `139c0ae68` and `bbf64b21c` — Antigravity implementation and initial docs baseline.
- F691 — release stabilisation and compact dashboard session controls.
- F693–F695 (`pro-merge`) — intentionally separate follow-up for all Pro terminology/removal.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="132" viewBox="0 0 568 132" role="img" aria-label="Feature dependency graph for feature 698" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-698" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-698)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#f59e0b" stroke-width="3"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#698</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh public docs for c…</text><text x="36" y="90" font-size="12" fill="#475569">in-progress</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
