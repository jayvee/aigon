---
complexity: medium
set: aigon-install-contract
depends_on: [422]
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:20:50.287Z", actor: "cli/feature-prioritise" }
---

# Feature: refresh-brewboard-seed-post-install-contract

## Summary

Brewboard is one of aigon's seed demo repos (alongside trailhead — see `seed-reset` skill). After F2/F3/F4 land, brewboard's canonical seed state contains legacy install artifacts: aigon marker block in `AGENTS.md`, `docs/development_workflow.md`, `docs/agents/`, no install manifest, possibly `docs/aigon-project.md`. This feature regenerates brewboard's seed to match the new install contract AND uses the migration as the end-to-end test for the F2/F3/F4 doctor migrations. The acceptance test is: a copy of brewboard at the *legacy* state, run through `aigon doctor --fix`, must match the *new* canonical seed byte-for-byte (modulo timestamps in the manifest).

## User Stories
- As an aigon maintainer running `aigon seed-reset brewboard`, I want the resulting state to reflect the new install contract (no AGENTS.md scaffold, vendored docs in `.aigon/docs/`, manifest present).
- As a tester verifying F2/F3/F4 migrations end-to-end, I want a real-world repo (not just synthetic temp dirs) that exercises every migration step in sequence.
- As an aigon user who reads brewboard as the canonical example of "what does an aigon-installed repo look like?", I want it to demonstrate the post-cleanup contract, not the legacy state.

## Acceptance Criteria
- [ ] Brewboard seed regenerated:
  - `AGENTS.md` has no aigon marker block (consumer-owned content only — brewboard's own description, with optional one-line "uses aigon" pointer).
  - `docs/aigon-project.md` does not exist.
  - `docs/development_workflow.md` does not exist; `.aigon/docs/development_workflow.md` does exist.
  - `docs/agents/` does not exist; `.aigon/docs/agents/cc.md` (and any other installed agents) exist.
  - `.aigon/install-manifest.json` exists and is well-formed.
  - `.claude/`, `.cursor/`, `.codex/`, `.gemini/`, `.agents/` per-agent install footprints intact.
- [ ] `lib/commands/setup.js` (or wherever seed-reset is implemented — verify) updated if its target seed state references old paths.
- [ ] Migration test script `scripts/test-brewboard-migration.sh`:
  - Step 1: clones brewboard at the legacy commit (or constructs a synthetic legacy state from a checked-in fixture).
  - Step 2: runs `aigon doctor --fix` against the legacy state.
  - Step 3: diffs the result against the new canonical seed state (excluding `.aigon/install-manifest.json` `installedAt` timestamps and any other inherently-non-deterministic content — use `jq` to normalize).
  - Step 4: asserts diff is empty; exits non-zero with helpful output if not.
- [ ] Test added to CI (`npm test` or a dedicated `npm run test:migration` target — pick based on existing test taxonomy in `package.json`).
- [ ] Documentation: `docs/README.md` (from F1) entry for `scripts/test-brewboard-migration.sh` — one-line description.
- [ ] `docs/development_workflow.md` (now at `.aigon/docs/development_workflow.md`) or `docs/architecture.md` adds a brief "Migration testing" section pointing at the script and explaining how to run it locally against a real brewboard checkout.
- [ ] `seed-reset` skill (`skills/seed-reset` per memory) updated if it has any hardcoded references to old paths in brewboard's expected state.

## Validation
```bash
bash scripts/test-brewboard-migration.sh
# Should exit 0 and report:
#   ✅ Brewboard legacy state successfully migrated to current contract
test -f .aigon/install-manifest.json   # in brewboard checkout post-migration
! test -f docs/aigon-project.md
! test -f docs/development_workflow.md
test -f .aigon/docs/development_workflow.md
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets. Playwright still runs at the pre-push gate.
- May modify brewboard's seed state directly (it's a maintained demo repo, expected to drift in lockstep with aigon).
- May invoke `aigon seed-reset brewboard` and `aigon install-agent` repeatedly during implementation to converge the seed.

## Technical Approach

Two halves:
1. **Regenerate the seed.** Start from a fresh brewboard, run `aigon install-agent cc` (and any other agents brewboard's seed normally has), capture the resulting state as the new canonical seed. Commit + push to brewboard's seed branch. Verify `aigon seed-reset brewboard` produces the new state.
2. **Build the migration test.** Construct a "legacy state" fixture — easiest via a `legacy-fixtures/brewboard/` snapshot committed into aigon-the-repo (small set of files: legacy `AGENTS.md` with marker block, `docs/development_workflow.md`, `docs/agents/cc.md`, `docs/aigon-project.md`, `.claude/...`). The migration test copies the fixture into a temp dir, runs `aigon doctor --fix`, then diffs against the canonical post-migration state.

For the diff to be deterministic, normalize the manifest's `installedAt` timestamps (replace with a placeholder) and any other non-deterministic content. Use `jq` for JSON normalization, `diff -r` for the rest.

If brewboard's seed branch lives in a separate repo (verify via `seed-reset` source), part 1 is a cross-repo PR — coordinate accordingly. The test fixture lives in aigon-the-repo and doesn't depend on brewboard being checked out for the test to run.

## Dependencies
- depends_on: install-manifest-tracked-files

## Out of Scope
- Refreshing the trailhead seed (other demo repo per memory) — separate feature if needed; same pattern applies.
- Adding migration tests for hypothetical future migrations — this feature establishes the pattern; future migrations add their own fixtures.
- Updating brewboard's actual product code or features — only the aigon install footprint is touched.

## Open Questions
- Where does brewboard's seed actually live — separate repo or branch in this repo? **Action:** verify via `seed-reset` skill source at start of implementation.
- Should the legacy fixture be committed verbatim or generated from a known-old aigon version on demand? **Default:** committed verbatim — easier to reason about, immune to old-version code being unavailable.
- Should we also test "migration is idempotent" (run `doctor --fix` twice → second run is a no-op)? **Default:** yes, add as a sub-assertion in the test script.

## Related
- Set: aigon-install-contract
- Prior features in set: F-aigon-repo-internal-doc-reorg, F-stop-scaffolding-consumer-agents-md, F-vendor-aigon-docs-to-dot-aigon-folder, F-install-manifest-tracked-files
- Doubles as the acceptance test for F2, F3, and F4 doctor migrations.
- See `seed-reset` skill for canonical seed-state mechanism.
## Dependency Graph

<!-- AIGON_DEP_GRAPH_START -->
<svg xmlns="http://www.w3.org/2000/svg" width="1468" height="132" viewBox="0 0 1468 132" role="img" aria-label="Feature dependency graph for feature 423" style="font-family: system-ui, -apple-system, sans-serif"><defs><marker id="dep-arrow-423" markerWidth="10" markerHeight="8" refX="9" refY="4" orient="auto"><path d="M0,0 L10,4 L0,8 Z" fill="#94a3b8"/></marker></defs><path d="M 1144 66 C 1184 66, 1184 66, 1224 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-423)"/><path d="M 844 66 C 884 66, 884 66, 924 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-423)"/><path d="M 544 66 C 584 66, 584 66, 624 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-423)"/><path d="M 244 66 C 284 66, 284 66, 324 66" fill="none" stroke="#94a3b8" stroke-width="2" marker-end="url(#dep-arrow-423)"/><g><rect x="24" y="24" width="220" height="84" rx="12" ry="12" fill="#dcfce7" stroke="#16a34a" stroke-width="2"/><text x="36" y="48" font-size="14" font-weight="700" fill="#0f172a">#419</text><text x="36" y="70" font-size="13" font-weight="500" fill="#1f2937">aigon repo internal doc r…</text><text x="36" y="90" font-size="12" fill="#475569">done</text></g><g><rect x="324" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="336" y="48" font-size="14" font-weight="700" fill="#0f172a">#420</text><text x="336" y="70" font-size="13" font-weight="500" fill="#1f2937">stop scaffolding consumer…</text><text x="336" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="624" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="636" y="48" font-size="14" font-weight="700" fill="#0f172a">#421</text><text x="636" y="70" font-size="13" font-weight="500" fill="#1f2937">vendor aigon docs to dot …</text><text x="636" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="924" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#6b7280" stroke-width="2"/><text x="936" y="48" font-size="14" font-weight="700" fill="#0f172a">#422</text><text x="936" y="70" font-size="13" font-weight="500" fill="#1f2937">install manifest tracked …</text><text x="936" y="90" font-size="12" fill="#475569">backlog</text></g><g><rect x="1224" y="24" width="220" height="84" rx="12" ry="12" fill="#e5e7eb" stroke="#f59e0b" stroke-width="3"/><text x="1236" y="48" font-size="14" font-weight="700" fill="#0f172a">#423</text><text x="1236" y="70" font-size="13" font-weight="500" fill="#1f2937">refresh brewboard seed po…</text><text x="1236" y="90" font-size="12" fill="#475569">backlog</text></g></svg>
<!-- AIGON_DEP_GRAPH_END -->
