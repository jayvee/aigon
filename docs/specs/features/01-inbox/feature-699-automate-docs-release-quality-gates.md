---
aigon_id: F699
complexity: high
set: docs-release-readiness
depends_on: [refresh-public-docs-for-current-oss]
---

# Feature: automate-docs-release-quality-gates

## Summary

Prevent the public documentation from drifting back after F698 by adding a non-destructive
documentation/release quality gate derived from executable commands, the agent registry, and
the built site. Replace or redesign the stale command generator, require complete metadata
and valid links, make command help side-effect-free, generate genuinely useful LLM/sitemap
outputs, and integrate the checks into the release path without bloating every iteration.
Preserve the current Aigon Pro terminology and classifications until the separate
`pro-merge` set changes the product.

## User Stories

- [ ] As a user, every documented public command exists and every public command has either
      a reference page or an explicit reason it is internal/deprecated.
- [ ] As a user exploring safely, `<command> --help` prints help and never creates a feature,
      changes workflow state, starts setup, or performs another command action.
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

### Side-effect-free help

> **Spec review — this section is a live bug and should not be third in line.** Confirmed:
> `aigon-cli.js:258` only treats `--help` as help when it is the *resolved command*, i.e. the
> first argument. Anything later in argv is passed through as a normal parameter, so
> `aigon feature-create --help` creates a feature literally named `--help`. Reproduced
> incidentally during review: `aigon feature-spec-review-record --help` responded
> `❌ Could not resolve feature spec "--help"` — treating the flag as a spec identifier.
>
> This is the most user-visible defect in the whole set and it has **zero coupling** to the
> 108-page docs rewrite it currently sits behind. See Dependencies.

- [ ] Global argument handling intercepts `--help`/`-h` before command execution for every
      public command and subcommand — the guard lives in `aigon-cli.js` dispatch (widen the
      `resolvedCommand` check at `:258` to scan argv) so no individual handler can forget it.
- [ ] `aigon feature-create --help`, `aigon setup --help`, lifecycle mutations, server
      commands, and Pro stubs return usage with no file, workflow, config, process, or network
      changes.
- [ ] A temporary-repo/HOME regression test executes a representative matrix of help commands,
      snapshots filesystem/process-relevant state before/after, and includes the required
      `// REGRESSION:` comment.

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

- [ ] `llms-full.txt` contains the actual public documentation body (within an intentional,
      documented size policy), not only titles and descriptions; `llms.txt` remains the
      concise index.
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
- [ ] Focused regression tests consolidate existing command/help/docs checks where possible;
      every new test has `// REGRESSION:` and `scripts/check-test-budget.sh` remains green.
- [ ] **Do not assume test-budget headroom.** The suite was already 30 LOC over ceiling at
      review time (17255 vs 17225) with zero slack, and all three specs in this set add tests
      against that one shared ceiling. F697 has been made to own the pre-existing overage, but
      as the last feature in the chain this one inherits whatever F697 and F698 left. Re-run
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

Handle help centrally in CLI parsing/dispatch so individual commands cannot forget the guard.
Use isolated HOME/repo tests because setup and lifecycle commands otherwise mutate global or
workflow state.

## Dependencies

- `refresh-public-docs-for-current-oss` — the **checker** should lock in a corrected baseline,
  not require a large allowlist for known stale content. That reasoning is sound and applies to
  the "Documentation checker" and "Machine-readable and visual release artifacts" sections.

### Two sections do not depend on F698 — author decision needed

The dependency is real for the checker but **backwards** for these:

- **Side-effect-free help.** A CLI argv-parsing bug. Nothing about it touches docs content, and
  it is the cheapest, most user-visible fix in the set. Startable immediately.
- **Removing `site/scripts/gen-commands.js`.** The script already writes to a path nobody
  serves; deleting it does not need a corrected docs baseline to precede it.

As with F698, `depends_on:` was left untouched — resequencing the set is the author's call.
Recommend hoisting the help guard so it lands before or alongside F697 rather than waiting on
a 108-page rewrite. If the author prefers to keep the set strictly serial, that is a legitimate
choice, but the help bug then ships to users two features later than it needs to.

## Out of Scope

- Changing Aigon Pro terminology, availability, package status, tier boundaries, or public
  capability labels; the `pro-merge` set owns those changes.
- Running the actual version bump, tag, npm publish, or production deployment.
- Generating all documentation prose from source code.
- Rewriting historical changelog/spec/log content.

## Open Questions

Resolved by spec review (reopen if you disagree):

- ~~Should `docs:check` run in `prepublishOnly`, `test:release`, or both?~~ → **Both, via one
  shared script.** Two entry points calling one implementation cannot drift; two
  implementations can. This also satisfies the existing criterion about a single stable
  docs-check entry point.

Still needs the author's call:

- Should command references remain one page per command or group tightly related subcommands?
- What body-size limit should `llms-full.txt` enforce to remain useful without truncation?

## Related

- F698 — corrected documentation baseline.
- Commit `bbf64b21c` — the initial Antigravity naming pass whose correct portions the checker
  must keep from regressing.
- F691 — prior release stabilisation and test-budget work.
- F693–F695 (`pro-merge`) — future product-boundary change; this checker must make their
  deliberate terminology removal straightforward rather than block it.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="868" height="240" viewBox="0 0 868 240" role="img" aria-label="Feature dependency graph for feature 699" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-699" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-699)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-699)"/><path d="M 244 174 C 284 174, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-699)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#696</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">restore antigravity agent…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="24" y="132" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="36" y="156" font-size="14" font-weight="700" fill="#0f172a">#697</text><text x="36" y="178" font-size="13" font-weight="500" fill="#1f2937">harden setup wizard contr…</text><text x="36" y="198" font-size="12" fill="#475569">inbox</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#9ca3af" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#698</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh public docs for c…</text><text x="336" y="90" font-size="12" fill="#475569">inbox</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#f3f4f6" stroke="#f59e0b" stroke-width="3"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#699</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">automate docs release qua…</text><text x="636" y="90" font-size="12" fill="#475569">inbox</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
