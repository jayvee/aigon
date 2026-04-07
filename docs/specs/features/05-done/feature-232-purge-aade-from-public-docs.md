# Feature: purge-aade-from-public-docs

## Summary
Remove every user-facing reference to "AADE" from the public docs (README, `docs/architecture.md`, `site/content/`). AADE was the old internal codename for the commercial tier; the user-facing label has been "Insights" / "Pro" since the 2026-04-06 spec rename work, but four leaks remain in public copy. While we're in there, also fix two related dead-doc / missing-image bugs surfaced in the same audit. Tiny scope, ~30 minutes of edits, no behavior change.

## Scope — exact list of changes

### 1. AADE wording leaks (5 occurrences across 4 files)

| File | Line | Current | After |
|---|---|---|---|
| `README.md` | 44 | "...bundling autonomous orchestration, **AADE Insights**, and AI-powered coaching." | "...bundling autonomous orchestration, **Insights**, and AI-powered coaching." |
| `README.md` | 50 | `\| `aigon insights` \| **AADE Insights**, coaching, amplification metrics \|` | `\| `aigon insights` \| **Insights**, coaching, amplification metrics \|` |
| `docs/architecture.md` | 310 | "Commercial **AADE (Amplification)** features live in a separate private repo..." | "Commercial **Pro / Amplification** features live in a separate private repo..." |
| `site/content/comparisons.mdx` | 124 | `\| Enterprise features \| ◐ **AADE tier planned** \| ○ None \|` | `\| Enterprise features \| ◐ **Pro tier planned** \| ○ None \|` |
| `site/content/guides/_meta.js` | 10 | `amplification: "Insights (Amplification)",` | `amplification: "Insights",` |

### 2. Dead doc page

`site/content/reference/commands/feature/feature-submit.mdx` documents a command that returns `Unknown command: feature-submit` when invoked. Either:

- **Option A (recommended)**: rewrite the page to mirror `feature-autopilot.mdx` — mark as `(removed)`, point users at `feature-do` (which now signals submission via `agent-status submitted`)
- **Option B**: delete the page entirely from `site/content/reference/commands/feature/` and remove the entry from `_meta.js`

Pick A — the deprecation page is more discoverable for users with bookmarks/search results pointing at the old URL.

### 3. Missing referenced images

`site/content/guides/amplification.mdx` references two images that don't exist on disk:
- Line 20: `<Screenshot src="/img/aigon-amplification-metrics.png" />`
- Line 31: `<Screenshot src="/img/aigon-amplification-charts.png" />`

The page also references `summary-pro.png` and `charts-pro.png` which DO exist and cover the same content. Fix: delete the two missing-image `<Screenshot>` lines. Don't leave broken image references on the live site.

## Acceptance Criteria

- [ ] **AC1** — `grep -rn "AADE\|aade" README.md docs/architecture.md site/content/` returns **zero** matches outside historical spec logs (`docs/specs/features/05-done/` and `docs/specs/features/logs/` which are historical records and must NOT be edited)
- [ ] **AC2** — `feature-submit.mdx` is rewritten as a deprecation page following the pattern in `feature-autopilot.mdx`. Title becomes `feature-submit (removed)`. Body explains the command was removed and points users at `feature-do` + `aigon agent-status submitted`.
- [ ] **AC3** — `amplification.mdx` no longer references `aigon-amplification-metrics.png` or `aigon-amplification-charts.png`. Other image references on the page are unchanged.
- [ ] **AC4** — `_meta.js` label for the amplification guide is `"Insights"` (no `(Amplification)` parenthetical)
- [ ] **AC5** — `npm test` and `MOCK_DELAY=fast npm run test:ui` pass unchanged. No code changes, no test changes.
- [ ] **AC6** — `bash scripts/check-test-budget.sh` still under ceiling (no change expected — this feature touches no test files).
- [ ] **AC7** — Manual check: `npm run --prefix site dev` (or however the docs site runs locally) renders the changed pages without broken images, no missing-page 404s, and the navigation label says "Insights" instead of "Insights (Amplification)".

## Validation

```bash
# Find any remaining AADE leaks (should be empty after fix):
grep -rn "AADE\|aade" README.md docs/architecture.md site/content/ \
    | grep -v "specs/features/05-done\|specs/features/logs\|specs/research-topics" \
    || echo "✓ clean"

# Find any other broken /img/ references:
grep -rn "src=\"/img/" site/content/ | awk -F'"' '{print $2}' | sort -u | while read img; do
    [ -z "$img" ] && continue
    test -f "site/public${img}" || echo "MISSING: $img"
done

# Verify feature-submit is honest about being removed:
grep -i "removed\|unknown command" site/content/reference/commands/feature/feature-submit.mdx
```

## What is NOT changing

- Any code under `lib/` — purely documentation
- Test files — none touched
- The actual `aigon insights` CLI behavior — unchanged
- The Pro page content (`site/content/pro/page.tsx`) — separate concern, audit it later
- Internal codenames in `docs/specs/features/05-done/` or `docs/specs/features/logs/` — those are historical records
- The `aigon` package on npm — no version bump needed
- Marketing site infrastructure — only content, not styling/layout
- The icon, favicon, or any graphics

## Out of Scope

- Re-recording dashboard screenshots (separate task — see the 2026-04-07 dashboard images audit)
- Fixing the 8 Dependabot vulnerabilities (separate triage)
- Removing other dead-link pages beyond `feature-submit.mdx`
- Updating the live `aigon.build/pro` marketing page (out of repo)
- Renaming the `amplification.mdx` file itself (just its `_meta.js` label)
- Adding new content — purely subtractive

## Open Questions

None.

## Related

- **2026-04-07 docs audit** — surfaced the 5 AADE leaks, the dead `feature-submit.mdx` page, and the 2 missing image references
- **Feature 159** (`pro-autonomy-bundle`, shipped) — established the honest "Pro is coming later" framing; this feature extends that consistency to remove the old AADE codename
- **Inbox feature** `feature-remove-feature-submit-and-enforce-feature-do-submission` — the larger cleanup of `feature-submit` from the codebase. THIS feature only handles the doc page; the larger refactor is separate.
- **CLAUDE.md rule T1** (pre-push tests) — applies but no tests should fail since no code changes
- **CLAUDE.md rule T2** (new code ships with a test) — N/A, this is a doc-only feature
