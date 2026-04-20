# Feature: rethink-spec-review-workflow-state

## Summary
Spec-review state is currently encoded in git commit subjects (`spec-review:` and `spec-review-check:`) and reviewer identity in commit bodies (`Reviewer: <agent>`). The dashboard collector scans `git log` on every read to reconstruct "which specs have unacknowledged reviews" by pairing review commits with ack commits. This is git-as-database — brittle, slow, dependent on commit message discipline, and completely invisible to the workflow engine.

The 2026-04-20 "2 pending — unknown on DONE #246" bug exposed three distinct smells:
1. Reviewer identity was literally `unknown` (agent ran without its id) — no schema stopped it.
2. Pending state survived feature close because nobody ran `spec-review-check` — there was no forcing function.
3. A read-path filter (Done → suppress badge) was the quick fix, but the underlying model couldn't tell Done from not-Done because the engine never saw spec-reviews at all.

A second 2026-04-20 symptom exposed the same weakness from the dashboard-render side: a research card's action menu rendered **two identical "Review spec" items** instead of "Review spec" + "Check spec review". The workflow rules in `lib/research-workflow-rules.js` and `lib/feature-workflow-rules.js` define distinct labels for `*_SPEC_REVIEW` and `*_SPEC_REVIEW_CHECK`, but the dashboard still collapsed them — evidence that the CHECK action's label is being overwritten somewhere between rule definition and render (or the SPEC_REVIEW rule is being emitted twice when a pending review exists). Either root cause traces back to the same fact: spec-review is not a first-class engine concept, so the two actions are stitched together by convention rather than by typed state.

This feature picks a non-git-commit-based model for spec-review state and migrates to it. The goal is one authoritative store that the engine reads and writes, aligned with the Write-Path Contract in CLAUDE.md.

## User Stories
- [ ] As a user, when I review a spec (`afsr`), the pending-review state is recorded somewhere the engine can see — not scraped from commit subjects on every dashboard read.
- [ ] As the dashboard, when I render a feature card, I know whether spec-reviews are pending from a single data source that matches the engine's view of the world.
- [ ] As a reviewer agent, when I submit a review, my agent id is captured reliably (not left as `unknown`) — either from my invocation context or via validation at write time.
- [ ] As `feature-close`, when I close a feature, any outstanding spec-review is either resolved or explicitly declined, so Done items never carry stale pending state.

## Acceptance Criteria
- [ ] Selected design (see Technical Approach) is implemented: spec-review state lives in the chosen store, not in commit subjects.
- [ ] `afsr` / `afsrc` CLI commands write to the new store (and optionally still write a commit, but the commit is not load-bearing for state).
- [ ] `lib/dashboard-status-collector.js` spec-review scanner is replaced with a read of the new store — no more `git log` scans for review state.
- [ ] Migration: existing `spec-review:` / `spec-review-check:` commit history is walked once at install/upgrade time and backfilled into the new store, then never consulted again.
- [ ] Reviewer id is captured at write time; `Reviewer: unknown` becomes impossible (or at least flagged, not silently stored).
- [ ] Feature close forces resolution of outstanding spec-reviews (auto-ack, explicit-decline, or block-close — per chosen design).
- [ ] Regression test covers: review written → pending flag set, ack written → pending cleared, feature-close with outstanding reviews behaves per design, Done feature never shows pending badge.
- [ ] Dashboard action menu renders **exactly one** "Review spec" item when a prior review is not pending, and **"Review spec" + "Check spec review"** (distinct labels) when a prior review is pending — no duplicate labels, for either feature or research cards.
- [ ] Regression test covers: derive `validActions` for a feature and a research entity in inbox/backlog with and without a pending review; assert label uniqueness and that CHECK only appears when `pendingCount > 0`.
- [ ] `docs/architecture.md` updated: remove spec-review-via-commits from the write-path narrative, document the new store.

## Validation
```bash
node -c lib/dashboard-status-collector.js
node -c lib/commands/feature.js
npm test
bash scripts/check-test-budget.sh
```

## Technical Approach

### The current model (what we're replacing)
- Write path: `afsr` produces a git commit `spec-review: feature <id> — <summary>` with body `Reviewer: <agent>`. `afsrc` produces `spec-review-check: feature <id> — …`.
- Read path: `lib/dashboard-status-collector.js:300-400` walks `git log --format=... -- docs/specs/...`, parses subjects, reads bodies, and maintains a `closed`/`pending` record per spec path.
- Why it's bad: state lives in an append-only log nobody designed as a database (commit subjects have no schema, no types, and no transactional guarantees); every dashboard read re-scans the log; reviewer identity is free-text in a commit body; feature-close doesn't know the model exists, so Done features carry pending state forever.

### Options to consider (decide during spec-review on this feature)

**Option A — Per-feature JSON file in `.aigon/workflows/features/<id>/spec-review.json`.**
- Shape: `{ reviews: [{ reviewerId, submittedAt, ackedAt?, ackedBy?, summary, commitSha? }] }`
- Pros: Simplest non-engine option. Mirrors how other per-feature state is stored (review-state.json, stats.json, events.jsonl). Direct read → no git scan. Commit is optional (as an audit artefact), not the source of truth.
- Cons: Yet another per-feature file. No integration with the XState machine, so `feature-close` still needs a bespoke gate.

**Option B — Workflow-engine events.**
- Add event types: `spec_review.submitted { reviewerId, summary, at }`, `spec_review.acked { reviewerId?, ackedBy, at }`. Write via `persistEvent` → engine. Reducer projects them into the snapshot (`snapshot.pendingSpecReviews[]`).
- Pros: Strongly aligned with CLAUDE.md Write-Path Contract ("writes seed engine state; reads derive from it"). `feature-close` naturally sees pending reviews via the snapshot → can block close or auto-ack. Dashboard reads from the snapshot it's already reading. Fixes the "engine never saw spec-reviews" class of bug permanently.
- Cons: Requires XState machine edit (or at minimum a reducer-only passthrough event). More ceremony to land. Needs migration from commit history on upgrade.

**Option C — Sidecar index file (`.aigon/index/spec-reviews.json`) shared across entities.**
- Single file tracking all pending/resolved reviews across features and research.
- Pros: Very cheap to read. Good for cross-entity views ("everything awaiting review across the repo").
- Cons: Global file = contention risk; duplicates per-entity data; awkward to scope to a single feature. Worst of both worlds.

**Option D — Frontmatter on the spec file itself.**
- Add `spec_reviews:` YAML block to the spec markdown frontmatter.
- Pros: Co-located with the thing being reviewed; human-readable; survives spec moves between folders.
- Cons: Requires parsing frontmatter on every read (or caching); spec files are meant to be human-authored narrative markdown. Risks drift if humans hand-edit. Feedback entities already went down this road (`feedback` status in frontmatter) — worth noting the precedent but also worth asking whether that decision is still considered healthy.

**Option E — Keep git commits, but build a proper index once at commit time.**
- Use a git post-commit hook to project review commits into `.aigon/index/spec-reviews.json`. Read path hits the index, not git log.
- Pros: No migration needed (hook rebuilds from scratch if missing). Keeps audit trail in git.
- Cons: Still depends on commit message conventions; hooks don't run on `git am` / rebase / clone, so the index can drift; adds a new failure mode (stale index).

### Recommended direction (strong lean, open to debate in spec-review)
**Option B — workflow-engine events.**

Reasoning:
1. CLAUDE.md § State Architecture explicitly names the engine as the source of truth for lifecycle state. Spec-review is a lifecycle concept ("is this spec approved enough to work on?") and belongs there.
2. The Write-Path Contract incident list in CLAUDE.md (F270, F272, AutoConductor) is exactly the class of bug we just hit — read path assumed state the write path didn't produce. Putting spec-review in the engine ends the class.
3. `feature-close` already reads the snapshot; it gets the auto-ack-or-block decision "for free" once `pendingSpecReviews` lives there.
4. Dashboard already reads snapshots; the git-log scan in `lib/dashboard-status-collector.js:300-400` can be deleted outright (~100 lines gone).
5. Migration is bounded and one-shot: walk existing review commits once on install, emit synthetic engine events, done.

Option A is the acceptable fallback if engine changes feel too heavy. Option B is the better answer.

### Rollout shape (assuming Option B)
1. Add event types + reducer projection (`lib/workflow-core/` — projector.js, machine.js if state transitions need gating).
2. Rewrite `afsr` / `afsrc` to emit events (still optionally produce a commit for audit, with the commit explicitly marked "not authoritative").
3. Swap `applySpecReviewStatus` to read from snapshots instead of git log.
4. Add `feature-close` gate: block or auto-ack per product decision.
5. One-shot migration: walk `git log` once, emit `spec_review.submitted` / `spec_review.acked` events into each affected feature's events.jsonl, write a migration-complete marker.
6. Delete the git-log scanner.

## Dependencies
- Recommend landing `feature-fix-entity-submit-silent-signal-loss` first — that feature hardens the signal-emit path this feature will use for review events.
- `depends_on: fix-entity-submit-silent-signal-loss`

## Out of Scope
- Reviewer identity improvements beyond "don't let it be literal `unknown`" (agent-registry-level identity work belongs elsewhere).
- Cross-repo spec-review (aigon-pro concern).
- Visual design of the pending-review badge (that's a dashboard concern once the data model is right).
- Review content quality gates ("does the review have all the required sections?") — orthogonal.

## Open Questions
- Option B vs Option A: willing to take the engine-edit overhead, or is per-feature JSON enough for now? (Decide during spec-review.)
- Feature-close behavior on outstanding reviews: block, auto-ack-with-warning, or silent auto-ack? (Lean: auto-ack-with-warning — match the pragmatism of "user folded suggestions into the spec directly".)
- Do we keep writing `spec-review:` commits at all, for the git-history audit trail? (Lean: yes, but mark them "informational" in the subject and don't parse them.)
- Should research specs get the same treatment in the same feature, or split into a follow-up? (Lean: same feature — research-eval already has the same shape.)
- Is this a broader "git-as-workflow-state" audit? Other places the codebase uses commit subjects or file moves as state signals (e.g. `chore: start feature …` / `chore: complete feature …`) could be worth reviewing in the same pass, or deferred. (Lean: defer unless it's trivially adjacent; don't let scope explode.)

## Related
- Triggered by: 2026-04-20 Done-column pending-badge bug on feature #246 (fix landed in `lib/dashboard-status-collector.js` as a read-path `stage === 'done'` filter — see preceding commit).
- Also triggered by: 2026-04-20 duplicate "Review spec" menu item on a research card in the dashboard (see Summary) — same root cause class: spec-review is stitched from convention rather than typed engine state.
- Related: `feature-fix-entity-submit-silent-signal-loss` (same write-path-contract class).
- CLAUDE.md § State Architecture and § Write-Path Contract are the governing design documents.
