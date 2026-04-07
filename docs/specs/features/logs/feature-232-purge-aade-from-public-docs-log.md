# Implementation Log: Feature 232 - purge-aade-from-public-docs

## Plan

Doc-only cleanup. Five wording leaks of the old "AADE" internal codename
remained in public-facing copy after the 2026-04-06 spec rename. Plus two
related dead-doc bugs surfaced in the same audit:

1. Five `AADE` mentions across `README.md`, `docs/architecture.md`,
   `site/content/comparisons.mdx`, and `site/content/guides/_meta.js`
2. Dead `feature-submit.mdx` doc page (the command no longer exists)
3. Two broken image references in `site/content/guides/amplification.mdx`

No code changes, no test changes, ~30 minute scope.

## Progress

### AADE wording leaks (AC1)

- `README.md` line 44: "AADE Insights" → "Insights"
- `README.md` line 50: "AADE Insights" → "Insights"
- `docs/architecture.md` line 310: "AADE (Amplification)" → "Pro / Amplification"
- `site/content/comparisons.mdx` line 124: "AADE tier planned" → "Pro tier planned"
- `site/content/guides/_meta.js` line 10: `"Insights (Amplification)"` → `"Insights"`

Verified clean: `grep -rn "AADE\|aade" README.md docs/architecture.md site/content/`
returns no matches outside historical spec logs.

### feature-submit.mdx deprecation page (AC2)

Rewrote the page to mirror `feature-autopilot.mdx`:

- Title: `feature-submit (removed)`
- Body explains the command was removed
- Points users at `feature-do` (which now signals submission via the shell
  trap on clean exit) and `aigon agent-status submitted` for manual signaling
- Links to the Drive Mode guide for the full submission flow

### Broken image references (AC3)

Removed two `<Screenshot>` lines from `site/content/guides/amplification.mdx`:

- Line 20: `aigon-amplification-metrics.png` (file does not exist on disk)
- Line 31: `aigon-amplification-charts.png` (file does not exist on disk)

The page already has `summary-pro.png` and `charts-pro.png` covering the
same content — those files exist and remain referenced.

## Decisions

- **Kept the `Pro / Amplification` phrasing in `docs/architecture.md`** rather
  than collapsing fully to "Pro". The `Amplification` label is still the
  user-facing tab name in the dashboard, so the architecture doc benefits
  from naming both.
- **Did not rename `amplification.mdx` itself**, only its `_meta.js` label.
  The filename is referenced by URL slug `/docs/guides/amplification` which
  is already public; renaming it would break inbound links.
- **Did not touch historical specs in `05-done/` or `logs/`** even though
  they contain `AADE` references. Those are historical records and the
  acceptance criteria explicitly excluded them.

## Verification

- `npm test` — passes (full unit suite)
- `MOCK_DELAY=fast npm run test:ui` — 8/8 dashboard e2e tests pass
- `bash scripts/check-test-budget.sh` — 1853 / 2000 LOC (92% of budget)
- AC1–AC4 verified via grep (see acceptance criteria in spec)
- AC5/AC6 verified via test suite
- AC7 (manual visual check of rendered docs site) — skipped; changes are
  mechanical text edits and image-removals already verified by grep
