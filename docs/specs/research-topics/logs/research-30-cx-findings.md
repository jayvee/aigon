# Research Findings: multi user workflow state sync

**Agent:** Codex (cx)
**Research ID:** 30
**Date:** 2026-04-12

---

## Key Findings

### 1) What can be safely committed vs must stay local

**Good candidates to commit (durable, repo-level truth):**
- **Workflow engine event log** (`events.jsonl`) and **snapshot** (`snapshot.json`) *if* their contents are treated as team-visible workflow truth (i.e., no absolute worktree paths / PIDs / hostnames). In Aigon today, snapshots include `agents.*.lastHeartbeatAt` and similar “display” timestamps driven by events (see `lib/workflow-core/engine.js`), so they’re deterministic-from-events but still potentially noisy.
- **Review state** and other workflow-derived records that don’t embed machine-local paths.
- A **lightweight claim record** (who owns/claimed a feature) because it’s the “mutual exclusion” signal the team needs.

**Should stay gitignored (machine-local / high-churn / contention-prone):**
- **Locks** (`.aigon/locks/*`): they are inherently local; committing them doesn’t provide real exclusion and creates deadlock risk if a lock file outlives a machine.
- **Heartbeats / liveness pings**: if committed on every touch, they create constant commit noise and non-stop non-fast-forward pushes.
- **Per-agent status files** that embed local paths (worktrees, tmux session names, etc.) should remain local *or* be split into (a) committed “claim/owner” and (b) local runtime metadata.

Practical line: **commit “workflow intent + lifecycle truth”; keep “runtime telemetry” local**.

### 2) Co-location structure options (and trade-offs)

The question’s requirement “state travels alongside its spec as a single unit” implies the state must move with the spec through `02-backlog/ → 03-in-progress/ → …`.

**Option A — Feature-as-directory (strong co-location, best match)**
- Layout:
  - `docs/specs/features/<lane>/feature-42-foo/spec.md`
  - `docs/specs/features/<lane>/feature-42-foo/state/events.jsonl`
  - `docs/specs/features/<lane>/feature-42-foo/state/snapshot.json`
  - (optional) `docs/specs/features/<lane>/feature-42-foo/state/claim.json`
- Pros: true “single unit” (move directory); per-feature isolation minimizes merge conflicts; humans can inspect one folder.
- Cons: **largest migration**: spec resolver, templates, and any “find `feature-42-*.md`” code must learn the new layout.

**Option B — Sibling state directory next to the existing spec file (compromise)**
- Layout:
  - `docs/specs/features/<lane>/feature-42-foo.md`
  - `docs/specs/features/<lane>/feature-42-foo.state/{events.jsonl,snapshot.json,...}`
- Pros: minimal disruption to “spec is a file”; still co-located “near” the spec.
- Cons: move must be aware of the pair (file + directory). A `git mv` of only the `.md` silently strands state unless Aigon always moves both.

**Option C — Commit current `.aigon/workflows/features/<id>/...` (minimal code change)**
- Pros: smallest workflow-core change (paths stay stable); fastest to ship.
- Cons: does **not** satisfy “state travels alongside spec as a single unit”; `.aigon/workflows/` becomes a long-lived central state tree in the repo.

### 3) Spec moves with co-located state

Git can move a directory or file+directory pair with `git mv` and commit the result. If Aigon owns transitions (it does via workflow-core effects), the safe approach is:
- **Move the whole feature directory** (Option A), or
- **Move spec + state directory together** (Option B) in one transition effect.

Reference: `git mv` moves/renames files *and directories* and stages the change. https://git-scm.com/docs/git-mv.html

### 4) Locks and contention

Team sync via git means you can’t rely on a shared filesystem lock. Recommendation:
- Keep file locks **local only**.
- Use a **committed claim** as the “social + mechanical” exclusion signal.
- Treat “someone tried to start a claimed feature” as a UX problem: show who, when, and how to request/override.

### 5) Divergent event logs (same feature edited on two machines)

Even if “distinct features only” is the rule, the system needs a safe failure mode:
- Detect divergence by **eventCount / last event hash** in snapshot vs current log when writing.
- If divergence is detected: hard-stop with a message that tells the user to pull, inspect, and resolve (do not try to auto-merge semantically).

If you *do* want auto-merge for accidental dual appends, Git supports a “union” merge driver, but it explicitly warns that it can leave lines in random order, so only consider it if you also make reads order-insensitive (e.g., sort by `at` + `id`). https://git-scm.com/docs/gitattributes.html (merge driver “union”); see also https://git-scm.com/docs/git-merge-file (the `--union` concept).

### 6) Git/merge behavior and “commit noise”

In a pure-git transport, two users committing to `main` will frequently hit **non-fast-forward** push rejections; this is normal and resolved with pull/rebase + push (or an automated helper). For Aigon, that argues for:
- A dedicated `aigon sync` (or `aigon state-sync`) command that does: `git pull --rebase` → apply transition → commit → push (with retry).
- Avoid committing high-frequency telemetry (heartbeats) to keep the push loop sane.

### 7) Feature claiming: simplest git-only mechanism

Recommendation: a committed claim file inside the co-located state bundle:
- `state/claim.json` (or YAML) with fields like `{ claimedBy: { name, email }, claimedAt, branch, agent }`
- Identity derived from `git config user.name` / `user.email` (good enough for small teams).

Avoid git-notes for claims in the default path: notes live in `refs/notes/*` and are not always fetched/pushed by default, which makes them a poor “team-visible” lock signal unless you also ship explicit notes sync behavior. https://git-scm.com/docs/git-notes.html

### 8) Where workflow-core changes land (codebase reality check)

Today, workflow-core path computation is centralized in `lib/workflow-core/paths.js` and assumes `.aigon/workflows/<entity>/<id>/...`.
To support co-location you’d likely need:
- A config switch (e.g., `teamMode`) that changes “entity root” from `.aigon/workflows/...` to “derived-from-spec-path”.
- Updates to snapshot reads (`lib/workflow-snapshot-adapter.js`) to look in the new location(s).
- Transition effects (`move_spec`, `ensure_feature_layout`, etc.) updated so the “state bundle” moves with the spec.

## Sources

- Git `mv` (move/rename files *and directories*): https://git-scm.com/docs/git-mv.html
- Git attributes / merge drivers (incl. built-in `union` driver warning): https://git-scm.com/docs/gitattributes.html
- Git `merge-file` (`--union` semantics): https://git-scm.com/docs/git-merge-file
- Git notes (why refs/notes are not ideal as default “team lock”): https://git-scm.com/docs/git-notes.html
- Aigon code references: `lib/workflow-core/paths.js`, `lib/workflow-core/engine.js`, `lib/workflow-snapshot-adapter.js`, `lib/agent-status.js`

## Recommendation

Ship this in two stages so you can get multi-user value without a massive immediate migration:

1) **Team mode (opt-in) with committed “claim + durable workflow state”**
- Commit a per-feature **claim record** (owner/exclusion) and **durable workflow state** (events/snapshot/review state), but keep **locks + heartbeats + local runtime metadata** gitignored.
- Provide `aigon sync` to automate the pull/rebase/push loop around transitions to reduce user friction.

2) **True co-location as a feature bundle (Option A)**
- Migrate from “spec file” to “feature directory” so spec + state move together atomically through lanes.
- Keep a compatibility resolver so old `feature-42-*.md` layout can still be read during migration.

If the “single unit” requirement is non-negotiable, skip straight to Option A; otherwise, Stage 1 gives the quickest multi-user visibility and claiming with minimal surface area.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| team-mode-committed-state | Add opt-in config to commit durable workflow state (excluding locks/heartbeats). | high | none |
| feature-state-bundle-layout | Introduce feature/research “directory bundle” layout (`spec.md` + `state/`) and migrate readers/writers. | high | team-mode-committed-state |
| feature-claiming | Implement `feature-claim`/`feature-unclaim` and a committed `claim.json` (auto-claim on `feature-start`). | high | team-mode-committed-state |
| state-sync-command | Add `aigon sync` to pull/rebase/push around state transitions with retries. | medium | team-mode-committed-state |
| dashboard-team-visibility | Show `claimedBy` / “owned by” badges and team-visible status on board cards. | medium | feature-claiming |
| events-divergence-detection | Detect divergent event logs (eventCount/last-hash) and hard-stop with repair guidance. | medium | team-mode-committed-state |
| gitattributes-state-merge | Add `.gitattributes` rules for state files (e.g., union/ours/theirs) where safe. | low | team-mode-committed-state |
