# Implementation Log: Feature 497 - apply-2-digest-drift-detection
Agent: cc

## Status

All 7 acceptance criteria met. Semver drift detection replaced with content-based digest; zero false-positive path verified.

## New API Surface

- `lib/profile-placeholders.js` → `computeAppliedDigest(repoPath): string` — returns SHA-256 hex of all template sources + config
- `lib/profile-placeholders.js` → `computeAppliedDigestDetailed(repoPath): { digest, cats, files }` — full breakdown for drift summary
- `lib/profile-placeholders.js` → `readAppliedDigest(repoPath): { digest, cats, files }|null` — reads `.aigon/applied-digest` JSON (handles legacy hex string)
- `lib/profile-placeholders.js` → `writeAppliedDigest(repoPath, detailed): void` — writes JSON to `.aigon/applied-digest`; skips worktrees
- `lib/profile-placeholders.js` → `buildDriftSummary(stored, current): string` — "2 slash commands changed, 1 agent config changed"
- `lib/profile-placeholders.js` → `DIGEST_CATEGORY_LABELS` — singular/plural display names per category
- All exported via `lib/config.js` (re-export pattern)

## Key Decisions

- **Hash template sources, not on-disk outputs**: digest covers `templates/docs/`, `templates/specs/`, `templates/generic/commands/`, `templates/sections/`, `templates/agents/`, `templates/profiles/` + `profiles.json` + config fields. If sources don't change between CLI versions, digest doesn't change → no false drift. This is equivalent to hashing "what would be emitted" without needing a dry run.
- **JSON storage format** for `.aigon/applied-digest`: `{ v:1, digest, cats, files }` enables per-category and per-file diff on next check-version. Plain hex legacy files are handled gracefully (treated as legacy, triggers one-time sync).
- **Semver compare fully removed** from drift trigger in `check-version`. `.aigon/version` retained as human-readable provenance only (shown as "applied: v2.64.0" in messages).
- **Migration is automatic**: repos with `.aigon/config-hash` but no `.aigon/applied-digest` show "upgrade required" drift reason → `aigon apply` writes the new digest. No doctor command needed.
- **`buildDriftSummary` uses per-file hash diff** for accurate counts; falls back to per-category comparison if stored file hashes are missing (legacy compat).

## Gotchas / Known Issues

- The digest covers template sources in the CLI's own `templates/` directory; it does NOT cover agent command output files in the target repo. Any installed-but-modified user files are out of scope (intentionally — user changes are not "drift"). The categories hashed are purely the CLI's source templates.
- File keys use forward-slash prefixes (`commands/feature-do.md`, `config/__config__`, `profiles/_profiles.json`) to ensure consistent category extraction via `key.split('/')[0]`.

## Explicitly Deferred

- The in-session notice surface (feature #3 in apply-model set) — this feature provides the data, not the presentation.
- Dashboard drift pill (feature #4).
- Multi-repo `apply --all` (feature #5).
- Hashing agent output files (e.g., `.claude/commands/*.md`) in the target repo — requires knowing installed agents, too complex for the hash input set.

## For the Next Feature in This Set

- Call `readAppliedDigest(repoPath)` to get stored digest; compare `.digest` field for drift check.
- Call `computeAppliedDigestDetailed(repoPath)` for the current digest.
- `buildDriftSummary(stored, current)` produces the user-facing delta string.
- `.aigon/version` (string) = semver of last apply — provenance display only.
- `.aigon/applied-digest` (JSON) = the authoritative drift signal.
- Both are skipped in worktrees (worktree.json presence guard).

## Test Coverage

- Unit integration test: `computeAppliedDigestDetailed`, `readAppliedDigest`, `writeAppliedDigest`, `buildDriftSummary` all verified via inline node -e tests (not test files — spec didn't require new test files).
- Iterate gate (lint + scoped integration): passes clean.
- Spec validation patterns (`grep -q "current"`, `grep -q "out of date"`) verified against output messages.
