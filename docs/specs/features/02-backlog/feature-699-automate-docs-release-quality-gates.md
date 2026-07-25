---
aigon_id: F699
complexity: high
set: docs-release-readiness
depends_on: [697, 698]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-25T00:22:11.086Z", actor: "cli/feature-prioritise" }
---

# Feature: automate-docs-release-quality-gates

## Summary

Prevent the public documentation from drifting back after F698 by adding a non-destructive
documentation/release quality gate derived from executable commands, the agent registry, and
the built site. Replace or redesign the stale command generator, require complete metadata
and valid links, generate genuinely useful LLM/sitemap outputs, and integrate the checks into
the release path without bloating every iteration. F697 owns the independent global
side-effect-free help fix. Preserve the current Aigon Pro terminology and classifications
until the separate `pro-merge` set changes the product.

## User Stories

- [ ] As a user, every documented public command exists and every public command has either
      a reference page or an explicit reason it is internal/deprecated.
- [ ] As a docs author, a broken internal link, retired agent example, missing frontmatter,
      placeholder, wrong license, or stale generated endpoint fails before release.
- [ ] As a maintainer, documentation validation is one repeatable command with focused output,
      not a manual grep checklist.
- [ ] As an AI/search consumer, `llms-full.txt`, sitemap, canonical routes, and metadata
      accurately represent the public site.

## Acceptance Criteria

### Public command inventory

- [ ] Define one public-command inventory derived from executable handler registration/help,
      with an explicit classification for public, deprecated alias, Pro stub/gated command,
      and internal plumbing.
- [ ] The inventory includes current user-facing omissions such as feature list/status/spec,
      context/transfer/pause/resume/spec-review flows, research equivalents, agent
      probe/quota, commits/stats, profile/project context, and set workflows where applicable.
- [ ] Every public command resolves to a documentation page or an intentional grouped
      reference. Internal capture/session-hook commands are not forced into end-user docs.
- [ ] Existing hand-authored guidance remains canonical. Any generator creates scaffolds or
      a drift report and never overwrites enriched MDX pages.
- [ ] `site/scripts/gen-commands.js` is removed or corrected to target `site/content/reference`
      and use the executable inventory rather than slash-template metadata. Confirmed broken at
      review: `OUTPUT_DIR` (`gen-commands.js:24`) points at `../content/docs/reference/commands`,
      but the real pages live at `site/content/reference/commands` — so running it today writes
      a parallel tree nobody serves. Its input (`TEMPLATES_DIR`, `:23`) is
      `templates/generic/commands`, i.e. slash-command templates rather than CLI handlers,
      which is the wrong source of truth as the spec says. Removal is the cleaner option.

### Documentation checker

- [ ] Add one documented command/script (for example `npm run docs:check`) that validates:
      internal links and anchors; referenced local images; MDX frontmatter/title/description;
      zero placeholder markers; active agent IDs in current examples; Apache-2.0 marketing
      copy; command-reference coverage; and canonical route status.
- [ ] The agent-doc checks lock in F696/F698's supported Antigravity contract: current examples
      cannot regress to `gg`/Gemini CLI, undocumented Antigravity key/env-token authentication,
      headless support, or periodic quota-probe claims.
- [ ] The checker follows redirects deliberately, reports `/pro`/canonical loops or temporary
      redirects, and catches the previously broken uninstall link.
- [ ] Agent checks distinguish active examples from approved historical/model-family mentions;
      they do not reject legitimate `gg` telemetry compatibility code or historical specs.
- [ ] Pro terminology is not linted, renamed, or removed by this feature. Its existing public
      classification remains an allowed category until F693–F695 change it.
- [ ] The checker is fast enough for `prepublishOnly`/release use and is scoped or skipped by
      ordinary `test:iterate` unless site/command metadata changed.

### Machine-readable and visual release artifacts

- [ ] `llms-full.txt` contains the actual public documentation body, not only titles and
      descriptions; `llms.txt` remains the concise index. Enforce a 1 MiB UTF-8 output cap,
      fail with per-page size diagnostics rather than silently truncate, and document how to
      revisit the cap. The reviewed source corpus is about 361 KiB, leaving useful headroom.
- [ ] Sitemap `lastModified` values come from meaningful source metadata or are omitted.
- [ ] All sitemap/LLM URLs resolve successfully in the production build.
- [ ] Screenshot tooling has a documented source scenario and can refresh the required
      desktop/mobile docs images without pointing at the primary production dashboard.
- [ ] The release checklist requires gallery review at desktop and 390px plus the docs build,
      link checker, command drift checker, package/version/dist-tag agreement, and clean
      install wizard smoke.

### Integration and test budget

- [ ] `npm run build --prefix site` remains the production rendering gate and Pagefind indexes
      every intended docs page.
- [ ] `docs:check` is wired into the appropriate release/prepublish path without causing the
      heavy site build to run repeatedly during normal implementation.
- [ ] Focused regression tests consolidate existing command/docs checks where possible;
      every new test has `// REGRESSION:` and `scripts/check-test-budget.sh` remains green.
- [ ] **Do not assume test-budget headroom.** The suite was already 30 LOC over ceiling at
      review time (17255 vs 17225) with zero slack, and all three specs in this set use that
      one shared ceiling. F697 owns the pre-existing overage, but as the downstream feature
      this one inherits whatever F697 and F698 left. Re-run
      `check-test-budget.sh` *before* planning new tests and consolidate first if it is red.
- [ ] The repository release documentation identifies the final order: scoped validation,
      deploy gate, docs build/check, clean package install/setup smoke, full release gate,
      version/tag/publish.

## Validation

```bash
npm run docs:check
npm run build --prefix site
node scripts/check-pack.js
npm run test:iterate
bash scripts/check-test-budget.sh
```

The exact package script names may be adjusted to match repository conventions, but one
stable docs-check entry point is required.

## Pre-authorised

- May replace `site/scripts/gen-commands.js` if preserving it would retain the wrong source
  of truth; deletion must be called out in the implementation log.
- May add small focused checker scripts and package scripts without a separate confirmation.
- May skip full release tests mid-iteration; the release gate remains mandatory at close.

## Technical Approach

Separate facts from prose. Build a read-only inventory adapter over the same command factories
and agent registry used by the CLI, then compare that inventory with MDX metadata. Do not
introduce a second hand-maintained list that can drift in the opposite direction.

Implement the source checker first, then a built-site HTTP/HTML checker for routes, links, and
anchors. Keep output actionable: file, line, violated rule, and suggested owner. Avoid
snapshotting entire generated sites.

## Dependencies

- `harden-setup-wizard-contract` — the checker and clean-install release smoke lock in F697's
  corrected setup docs and behavior.
- `refresh-public-docs-for-current-oss` — the checker locks in F698's corrected site baseline
  rather than requiring a large allowlist for known stale content.
- F697 and F698 are parallel upstream features; this is their convergence point. The broken
  generator could be removed earlier, but keeping command inventory and replacement/scaffold
  behavior together is more coherent than splitting that small cleanup into another feature.

## Out of Scope

- Changing Aigon Pro terminology, availability, package status, tier boundaries, or public
  capability labels; the `pro-merge` set owns those changes.
- Running the actual version bump, tag, npm publish, or production deployment.
- Generating all documentation prose from source code.
- Rewriting historical changelog/spec/log content.
- Fixing global command-local `--help` dispatch; F697 owns that independently startable bug
  and its temporary-HOME regression matrix.

## Decisions

- Run `docs:check` from both `prepublishOnly` and `test:release` through one shared script.
- Command references may group tightly related subcommands when the command inventory maps
  every executable command to the exact page and anchor. Preserve a dedicated page where a
  command needs substantial examples or safety guidance.
- Cap `llms-full.txt` at 1 MiB UTF-8 and fail rather than truncate, with per-page diagnostics.
- Keep stale-generator cleanup with the command-inventory work; it does not justify another
  feature after the global help bug has been hoisted to F697.

## Related

- F697 and F698 — parallel corrected setup/content baselines.
- Commit `bbf64b21c` — the initial Antigravity naming pass whose correct portions the checker
  must keep from regressing.
- F691 — prior release stabilisation and test-budget work.
- F693–F695 (`pro-merge`) — future product-boundary change; this checker must make their
  deliberate terminology removal straightforward rather than block it.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="568" height="240" viewBox="0 0 568 240" role="img" aria-label="Feature dependency graph for feature 699" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-699" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-699)"/><path d="M 244 174 C 284 174, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-699)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#697</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">harden setup wizard contr…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="24" y="132" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="156" font-size="14" font-weight="700" fill="#0f172a">#698</text><text x="36" y="178" font-size="13" font-weight="500" fill="#1f2937">refresh public docs for c…</text><text x="36" y="198" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
