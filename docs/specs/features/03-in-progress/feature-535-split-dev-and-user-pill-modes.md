---
complexity: medium
---

# Feature: split-dev-and-user-pill-modes

## Summary

The dashboard status pill currently uses one vocabulary — *applied version*, *digest mismatch*, *stale* — to cover two very different audiences: normal users who installed Aigon globally via `npm i -g`, and the maintainer (John) who runs Aigon from a local checkout and edits templates between version bumps. The result is that rows can read `applied v2.66.0-beta.2` (matching the installed CLI) next to a **Re-apply** button, which is contradictory to anyone who isn't deep in the code. Split the pill into two modes so each audience sees vocabulary that fits its workflow.

## User Stories
- [ ] As a normal user (global npm install), I see one signal: did the CLI version I have installed change since I last applied it to this repo? If yes, one button: **Re-apply vX**. No mention of digests or templates.
- [ ] As the maintainer running from a local checkout, I see a separate "dev" pill that says *Templates edited locally* and offers **Sync registered repos** — no version language at all, because the version isn't the signal that matters.

## Acceptance Criteria
- [ ] Dev mode is detected via a single helper (e.g. `isAigonDevMode()` in `lib/version-status.js`) — true when the running CLI's `ROOT_DIR` contains a `.git` directory AND the package name is `@senlabsai/aigon` (i.e. the source repo itself, not a global install in node_modules).
- [ ] `/api/version-status` includes a new `devMode: boolean` field at the top level of the JSON response.
- [ ] In **user mode** (`devMode: false`): a repo row shows staleness *only* when `appliedVersion !== installedCli`. Digest-only drift does **not** mark the repo stale. Per-row label reads `applied v2.66.0-beta.2`; status word is `current` / `needs re-apply` / `never applied`; button reads **Re-apply vX** (where X is the installed CLI version).
- [ ] In **dev mode** (`devMode: true`): per-row version language is dropped. Status word is `synced` / `out of sync` / `never synced`; button reads **Sync**. The pill banner reads *"Templates edited locally — N repos out of sync"* (or `All repos synced` when zero). Digest mismatch is the signal that drives the *out of sync* state.
- [ ] No row in either mode shows both "applied vX" (matching installed) and a Re-apply/Sync button — the contradiction the user flagged disappears.
- [ ] Existing apply action (`POST /api/action` with `action: 'apply'`) continues to work unchanged. No backend behaviour changes — only labelling and the staleness threshold differ between modes.
- [ ] The CLI text drift notice (`formatDriftNotice` in `lib/version-status.js`) is **not** touched in this feature — out of scope. Only the dashboard pill changes.
- [ ] Tests: unit test for `isAigonDevMode()`. Browser smoke test (or scripted DOM check) confirming the pill renders the expected labels under both modes (env-var override of dev-mode detection in tests).

## Validation
```bash
npm run test:iterate
```

## Technical Approach

**Dev-mode detection** — add `isAigonDevMode()` to `lib/version-status.js`:
```
function isAigonDevMode() {
  if (process.env.AIGON_DEV_MODE === '1') return true;
  if (process.env.AIGON_DEV_MODE === '0') return false;
  const { ROOT_DIR } = require('./config');
  const fs = require('fs');
  const path = require('path');
  try {
    if (!fs.existsSync(path.join(ROOT_DIR, '.git'))) return false;
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT_DIR, 'package.json'), 'utf8'));
    return pkg.name === '@senlabsai/aigon';
  } catch (_) { return false; }
}
```
The env-var override gives tests a stable knob and lets the user force one mode for a debugging session.

**Backend** — `lib/dashboard-routes/version-status.js`:
- Replace `isRepoStale(status)` with two helpers: `isRepoStaleUserMode(status)` (version-only) and `isRepoStaleDevMode(status)` (digest-or-version-or-no-digest, the current behaviour).
- `summarizeRepoStatus(repoPath, devMode)` picks the right one.
- The `/api/version-status` handler computes `devMode` once at the top, passes it into every `summarizeRepoStatus` call, and includes it in the response payload.

**Frontend** — `templates/dashboard/js/aigon-status-pill.js`:
- Read `data.devMode` in `derivePhase` / `renderPhase3` / `renderRepoRow`.
- A small label table at the top of the file: `LABELS[mode] = { staleWord, currentWord, neverWord, actionWord, bannerTemplate }`. All rendering reads from this table — no inline conditionals scattered through the JSX.
- Drop the `applied v…` version stamp on rows in dev mode; replace with the `contentDelta` summary (e.g. `3 files drifted`) which is already on the payload.
- In user mode, hide the `contentDelta` (no longer the signal); show the version stamp.

**Tests** — add `tests/unit/version-status-dev-mode.test.js` covering:
1. `isAigonDevMode()` returns true when ROOT_DIR is a git repo with the right pkg name.
2. Env-var override works both ways.
3. `isRepoStaleUserMode` ignores digest mismatch.
4. `isRepoStaleDevMode` flags digest mismatch.

Browser test extension: in `tests/browser/` add a check that exercises the pill with `AIGON_DEV_MODE=0` and `=1` via `AIGON_TEST_INSTALLED_VERSION` to confirm labels switch. Defer to existing pill test file if one exists.

## Dependencies
- F499 (the three-phase upgrade pill itself, already shipped — this feature modifies it)

## Out of Scope
- Auto-sync (Option C in the discussion — not doing it).
- Changes to the CLI `formatDriftNotice` text.
- Changes to the `aigon apply` command itself.
- Renaming `.aigon/version` or the digest schema.

## Open Questions
- Should the dev-mode banner suggest `aigon apply --all` as a single CTA (apply-all-stale) on first click, or keep the per-row Sync button only? Default to per-row + the existing "Sync all N" button when N>1.

## Related
- Discussion thread in current session (2026-05-22) — user said current UI is "way too complex" and chose Option B (split audiences).
