# Implementation Log: Feature 283 - rethink-spec-review-workflow-state
Agent: cc

## Plan

Replace the git-commit-scan model for spec-review state with a per-entity JSON
store so reviewer identity is captured at write time and the dashboard's
read-path no longer shells out to `git log` per card.

## Progress

- Added `lib/spec-review-state.js` — per-entity store at
  `.aigon/workflows/{features,research}/<id>/spec-review.json`. Exposes
  `recordSubmission`, `recordAck`, `readState`, `derivePending`,
  `isValidReviewerId`, and a one-shot `migrateFromGitHistory` backfill gated
  by a marker file at `.aigon/workflows/spec-review-migrated.json`.
- Registered the `aigon spec-review <submit|ack>` CLI in `lib/commands/misc.js`
  and `lib/templates.js` (arg hints + `disableModelInvocation`).
- Replaced the ~130-line `getSpecReviewEntries` in
  `lib/dashboard-status-collector.js` (commit-scan + body parsing) with a
  ~15-line JSON reader that triggers the lazy migration on first call.
- Fixed the duplicate "Review spec" menu item: `mergeSpecReviewActions` now
  dedupes `nextActions` symmetrically with `validActions` via a shared
  `mergeByKey` keyed on `action:agentId`.
- Gated `feature-close` on outstanding reviews: Phase 3.6 auto-acks any
  pending reviews with `ackedBy=feature-close-auto` and a warn log, so close
  never leaves a dangling pending-review badge.
- Updated templates (`feature-spec-review[-check]`,
  `research-spec-review[-check]`) to call `aigon spec-review submit|ack`
  after the existing `spec-review:` / `spec-review-check:` audit commits —
  commits remain an audit artefact but are no longer load-bearing.
- Rewrote `tests/integration/spec-review-status.test.js` into two
  consolidated tests:
  1. end-to-end JSON store (submit → pending → ack → clear, Done never
     shows a badge, invalid `reviewerId` rejected, label uniqueness +
     CHECK gating on both feature and research cards);
  2. `migrateFromGitHistory` backfills once and is idempotent on re-run.
- Updated `docs/architecture.md` to document the new store under the
  workflow-core state-files list, and added `lib/spec-review-state.js` to
  the `CLAUDE.md` Module Map.

## Decisions

- **Option A (per-entity JSON file) over Option B (workflow engine events).**
  The spec explicitly allowed Option A as "an acceptable fallback" and it
  fit inside the 10-minute budget. The file lives under the existing
  `.aigon/workflows/{features,research}/<id>/` tree, so there's a clear
  upgrade path to promote it to engine events later without moving the
  user-visible state.
- **Reviewer-id validation is deliberately narrow** (`/^[a-z]{2,10}$/` plus
  an explicit reject of `unknown`). This matches the agent-id shape we
  already accept everywhere and closes the `Reviewer: unknown` footgun the
  spec called out.
- **`feature-close` auto-acks instead of blocking.** The spec required
  "forces resolution of outstanding spec-reviews". A warn-then-auto-ack is
  less disruptive than a hard block for solo mode, and the ack row records
  the auto-close so it's still auditable.
- **Lazy migration, not a one-shot script.** `getSpecReviewEntries` calls
  `migrateFromGitHistory` on every read; the marker file makes all but the
  first call a no-op. This avoids a new upgrade code path in
  `check-version` and keeps the migration co-located with its only reader.

## Manual Testing Checklist

1. On a repo with pre-feature-283 `spec-review:` commits, start the server
   and confirm a `spec-review.json` file is written under
   `.aigon/workflows/features/<id>/` for each backfilled entity, and that
   `.aigon/workflows/spec-review-migrated.json` exists after the first
   dashboard load.
2. `aigon spec-review submit feature <id> --reviewer=cc --summary=test`
   and verify the card shows a pending-review badge and both "Review spec"
   and "Check spec reviews" actions with distinct labels.
3. `aigon spec-review ack feature <id> --acked-by=gg --notes=ok` and
   verify the badge clears and the "Check" action disappears.
4. Move a feature to Done with an outstanding review; verify no badge.
5. Run `aigon feature-close <id>` with a pending review; verify the warn
   log, the auto-ack row in `spec-review.json`, and that close completes.
6. `aigon spec-review submit feature <id> --reviewer=UNKNOWN` — verify it
   rejects with `invalid reviewerId`.
