---
complexity: high
set: git-branch-storage
depends_on: [611, 612]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-07-05T13:12:21.620Z", actor: "cli/feature-prioritise" }
---

# Feature: git-branch-convert-and-git-ref-removal

## Summary
Finish the replacement: teach `aigon storage convert` to migrate repos onto the `git-branch` backend (from both `local` and `git-ref`), then **remove the `git-ref` backend entirely** — code, config surface, doctor/report/status paths, docs, and tests. After this feature there are exactly two backends: `local` (default) and `git-branch`. This lands last in the set deliberately: conversion and deletion only happen once the CAS backend is observable (dashboard/doctor) and proven by the race harness. Removal is judgment-heavy deletion work — the F294/b1db12d3 incident (deleting compat read paths while producers still wrote the old shape) is the failure mode to actively design against: migrate the producers (convert), then delete the readers, then grep for stragglers.

## User Stories
- [ ] As a user on `local` storage, `aigon storage convert --backend=git-branch --remote=origin` validates push access, imports my existing workflow events into the `aigon-state` branch, syncs, and flips my config — one command, no manual steps.
- [ ] As a user on the old `git-ref` backend, the same command imports every `refs/aigon/specs/*/events` stream into the branch (verified complete), cleans up the old refs, and flips my config — with `--keep-refs` available if I want the old refs left in place.
- [ ] As a user whose `.aigon/config.json` still says `git-ref` after upgrading aigon, every storage-touching command fails loudly with the exact convert command to run — never a silent fallback to `local` that would hide unsynced state.

## Acceptance Criteria
- [ ] `aigon storage convert --backend=git-branch --remote=<remote> [--branch=<name>] [--keep-refs] [--dry-run]` handles `local` → `git-branch` and `git-ref` → `git-branch`. Dry-run prints the plan (specs found, event counts, refs to import/delete) without writing. On success, `.aigon/config.json` is flipped to `{ backend: "git-branch", git: { remote, branch, offline } }` with `branch` defaulting to `aigon-state`.
- [ ] git-ref import is verified: per spec, event ids in the branch after import are a superset of ids in the source ref, **including `stats.recorded` events**, and counts are printed; any mismatch aborts before config flip and before any ref deletion.
- [ ] Conversion is ordered for safety: import → sync/push branch → verify → flip `.aigon/config.json` → delete `refs/aigon/specs/*` locally and on the remote (skipped with `--keep-refs`, with a printed cleanup command for later). An interruption at any step leaves a re-runnable state (idempotent re-convert).
- [ ] Active leases in the git-ref stream: unexpired advisory leases found during conversion are re-expressed as lease files on the branch (preserving holder/expiry) so a mid-flight team converting doesn't lose claim visibility; expired ones are dropped.
- [ ] `storage-config.js` no longer accepts `git-ref`: a config specifying it produces a hard, non-zero error naming `aigon storage convert --backend=git-branch` (loud path per F294 discipline — explicitly not a silent coercion to `local`).
- [ ] Deleted outright: `lib/spec-store/git-ref-backend.js`, git-ref-only branches in `doctor.js`/`report.js`/`convert.js`/`storage.js` command output, `DEFAULT_REF_PREFIX`/`refPrefix` config surface, git-ref-only tests, and git-ref sections in `docs/specstore-architecture.md` + `docs/architecture.md`. `git-plumbing.js` keeps only what git-branch uses.
- [ ] Grep discipline: `git grep -iE "git-ref|refPrefix|refs/aigon/specs"` over `lib/`, `templates/`, `docs/`, `scripts/` returns only intentional survivors (CHANGELOG history, migration/convert code and its tests, and the config-error message) — enumerated in the implementation log.
- [ ] Template boundary respected: any template/docs text that mentioned git-ref storage is updated; `scripts/check-template-leaks.js` passes.
- [ ] `CHANGELOG.md` entry documents the replacement, the convert command, and the breaking config change; `docs/specstore-architecture.md` backend table shows `local` + `git-branch` only, with this set's feature numbers appended to the history table.
- [ ] Full harness (`git-branch-two-clone-race-harness`) and `npm run test:core` pass after removal; a conversion integration test covers local→branch and git-ref→branch (fixture repo with pre-seeded refs), including the abort-on-mismatch path and idempotent re-run.

## Validation
```bash
node -c aigon-cli.js
npm run test:related -- tests/integration lib/spec-store lib/commands/storage.js
npm run test:core
```

## Technical Approach
- Extend `lib/spec-store/convert.js`; the git-ref reading code needed for import should be inlined/scoped there (import-only), so the backend module itself can be deleted while conversion retains the ability to read old refs for the foreseeable future.
- Config flip is the commit point: everything before it is read/additive; everything after (ref deletion) is cleanup that can safely re-run or be skipped.
- Remote ref deletion via `git push <remote> --delete refs/aigon/specs/...` batched; tolerate partially-deleted remotes on re-run.
- Sequence the edits to keep every intermediate commit green: (1) convert support + config hard-error, (2) migrate/rename shared render paths, (3) delete backend + tests, (4) docs. Follow AGENTS.md § Write-Path Contract grep list before declaring done.
- Check `## Pre-authorised` before stopping on any policy gate for ref deletion on remotes.

## Dependencies
- depends_on: git-branch-observability, git-branch-two-clone-race-harness

## Out of Scope
- Any new backend capability — this feature only migrates and deletes.
- Removing the `local` backend or changing its default status.
- `~/.aigon/remotes/` bare-mirror report flows beyond making them git-branch-aware where they referenced refPrefix.
- Automated migration of third-party repos (the error message + convert command is the migration UX; there is no known installed base beyond maintainer repos pre-npm-release).

## Open Questions
- Whether `aigon doctor --fix` (repo-level) should detect a `git-ref` config and offer the convert command interactively, mirroring its snapshotless-spec guidance — recommended yes if low-cost during implementation.

## Related
- Research: —
- Set: git-branch-storage
- Prior features in set: git-branch-backend-core, git-branch-cas-leases, git-branch-observability, git-branch-two-clone-race-harness
- Prior art: F597 (`aigon storage convert`), F294 (loud-path discipline / compat-removal incident), `docs/specstore-architecture.md`.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1168" height="240" viewBox="0 0 1168 240" role="img" aria-label="Feature dependency graph for feature 613" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-613" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-613)"/><path d="M 844 174 C 884 174, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-613)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-613)"/><path d="M 544 66 C 584 66, 584 174, 624 174" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-613)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-613)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#609</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch backend core</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#610</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch cas leases</text><text x="336" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#611</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch observability</text><text x="636" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="624" y="132" width="220" height="84" rx="12" ry="12" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/><text x="636" y="156" font-size="14" font-weight="700" fill="#0f172a">#612</text><text x="636" y="178" font-size="13" font-weight="500" fill="#1f2937">git branch two clone race…</text><text x="636" y="198" font-size="12" fill="#475569">in-progress</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#613</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">git branch convert and gi…</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
