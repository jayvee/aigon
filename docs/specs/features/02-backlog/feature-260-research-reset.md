# Feature: research-reset

## Summary

Add a first-class `aigon research-reset <ID>` command and wire research reset flows to use it instead of leaking through `feature-reset`. Reset should mean "return this research topic to a fresh backlog state" with research-specific cleanup: close running research sessions, remove findings artifacts and research status files, move the topic spec back to `02-backlog/`, and wipe `.aigon/workflows/research/<id>/` engine state. This fixes the current conceptual and likely behavioral bug where research reset is either unavailable or incorrectly routed through feature-only cleanup logic.

## User Stories

- [ ] As a user who started a research topic with the wrong agent set or wrong scope, I can run `aigon research-reset <id>` once and get back to a clean backlog topic without manually deleting logs or engine state.
- [ ] As a user resetting research from the dashboard or another UI surface, I get research-specific cleanup behavior rather than feature-only cleanup that talks about worktrees and branches.
- [ ] As an aigon maintainer, research and feature reset flows are symmetric at the product level but implemented with entity-specific cleanup logic, so the command surface makes sense and future bugs are easier to reason about.

## Acceptance Criteria

- [ ] **AC1** — A new CLI command exists: `aigon research-reset <ID>`. It is registered in the command metadata/template system alongside the other `research-*` commands.
- [ ] **AC2** — `research-reset` closes active research sessions for that ID before cleanup begins, using the existing shared session-closing behavior rather than duplicating process/tmux teardown logic.
- [ ] **AC3** — `research-reset` removes research findings artifacts for the topic from `docs/specs/research-topics/logs/`, specifically files matching `research-{id}-*-findings.md`.
- [ ] **AC4** — `research-reset` removes research runtime/status artifacts for that ID from `.aigon/state/`, including `research-{id}-*.json` status files and heartbeat files for matching agents when present.
- [ ] **AC5** — `research-reset` moves the research spec back to `docs/specs/research-topics/02-backlog/` from any active research stage that represents started work (`03-in-progress`, `04-in-evaluation`, `06-paused`, and review-related active states if applicable).
- [ ] **AC6** — `research-reset` removes workflow engine state for the topic from `.aigon/workflows/research/{id}/`, including snapshot, events, stats, and review-state files by deleting the entity root via workflow-core API rather than hand-assembling paths in the CLI.
- [ ] **AC7** — Reset is idempotent. Running `aigon research-reset <id>` twice in a row does not fail; the second run is a no-op where artifacts are already gone.
- [ ] **AC8** — `research-reset` does not call `feature-reset` internally and does not delete feature branches/worktrees as part of normal research cleanup.
- [ ] **AC9** — Any dashboard or unified action surface that currently offers research reset is updated to dispatch `research-reset`, not `feature-reset`.
- [ ] **AC10** — If the workflow engine state directory does not exist, `research-reset` succeeds cleanly without warning spam.
- [ ] **AC11** — The console output clearly reports research-specific cleanup performed: sessions closed, findings removed, state removed, spec moved, engine state removed.
- [ ] **AC12** — Documentation is updated where reset behavior or command inventory is described (`AGENTS.md`, relevant agent docs/templates, and architecture docs if the action surface changes materially).

## Validation

```bash
node --check lib/commands/research.js
node --check lib/workflow-core/engine.js
npm test

# Manual end-to-end:
# 1. Start a throwaway research topic and generate findings/state
# 2. Run: aigon research-reset <id>
# 3. Verify:
#    - spec is in docs/specs/research-topics/02-backlog/
#    - docs/specs/research-topics/logs/research-<id>-*-findings.md are gone
#    - .aigon/workflows/research/<id>/ does not exist
#    - .aigon/state/research-<id>-*.json and heartbeat-<id>-* are gone
# 4. Run: aigon research-start <id>
# 5. Confirm it starts cleanly as a fresh backlog topic
```

## Technical Approach

### Product behavior

Research needs the same user-facing reset concept as features, but not the same implementation. Feature reset removes worktrees, feature branches, preview servers, and feature engine state. Research reset should instead clean up findings files, research status files, research review artifacts, and research engine state. Sharing the word "reset" is correct; sharing the implementation is not.

### 1. Add first-class command support

- Add `research-reset` to the research command registry in [`lib/commands/research.js`](</Users/jviner/src/aigon/lib/commands/research.js>).
- Add command metadata in [`lib/templates.js`](</Users/jviner/src/aigon/lib/templates.js>) and create a matching template in `templates/generic/commands/research-reset.md`.
- Update agent docs/templates so the command shows up in the generated help/inventory where appropriate.

### 2. Add workflow-core API for research reset

`feature-reset` already depends on [`wf.resetFeature(...)`](</Users/jviner/src/aigon/lib/workflow-core/engine.js:737>). Research should get the symmetric API:

```js
async function resetResearch(repoPath, researchId) {
  const { root } = getEntityWorkflowPaths(repoPath, 'research', researchId);
  if (!fs.existsSync(root)) return { removed: false, path: root };
  fs.rmSync(root, { recursive: true, force: true });
  return { removed: true, path: root };
}
```

Recommendation: expose `resetResearch` from workflow-core rather than hardcoding `.aigon/workflows/research/<id>/` deletion inside the CLI handler. That keeps the CLI thin and matches the feature-reset cleanup architecture introduced by feature 242.

### 3. Research-specific reset handler

Implement `research-reset` in [`lib/commands/research.js`](</Users/jviner/src/aigon/lib/commands/research.js>) with this sequence:

1. Resolve/pad the ID consistently.
2. Close sessions for that research ID using shared session-closing infrastructure.
3. Remove research findings logs `research-{id}-*-findings.md`.
4. Remove `.aigon/state/research-{id}-*.json`.
5. Remove `.aigon/state/heartbeat-{id}-*` files for research agents.
6. Move the research spec back to `02-backlog/` from active folders.
7. Remove workflow-core state via `wf.resetResearch(process.cwd(), paddedId)`.
8. Print a concise summary.

This should not delete feature branches/worktrees unless the codebase has some genuine research worktree concept that is explicitly owned by research lifecycle. Based on current code, research primarily uses findings files plus sessions, not feature-style worktrees.

### 4. Dashboard / action surface

The research workflow rules currently expose no reset action, while features already have one. Add the equivalent research action path:

- add `ManualActionKind.RESEARCH_RESET`
- add a research action candidate in [`lib/research-workflow-rules.js`](</Users/jviner/src/aigon/lib/research-workflow-rules.js>)
- map it in [`lib/workflow-snapshot-adapter.js`](</Users/jviner/src/aigon/lib/workflow-snapshot-adapter.js>)
- allow it in [`lib/dashboard-server.js`](</Users/jviner/src/aigon/lib/dashboard-server.js>)
- dispatch it in `templates/dashboard/js/actions.js`

The UI should treat it as destructive, exactly like feature reset, but call `research-reset`.

### 5. Reuse vs refactor

There is obvious overlap between `feature-reset` and the proposed `research-reset`. Do not copy-paste the whole handler. Extract only the genuinely shared pieces if that reduces code without blurring entity ownership:

- session-closing helper that already handles both `feature-do` and `research-do`
- maybe a small generic helper for removing state files by prefix
- maybe a generic `resetEntityWorkflowState(entityType, id)` wrapper inside workflow-core

Do not force research through feature terminology just to chase deduplication.

### Edge cases

- Research spec already in backlog: cleanup still succeeds; spec move is a no-op.
- No findings files exist: no warning, no failure.
- Engine state absent: no-op.
- Session-close partially fails: warn, continue with cleanup.
- Active review state exists (`review-state.json` under research workflow root): deleting the workflow root removes it automatically.
- Topic is in `05-done`: out of scope for reset unless product decides done research can be reopened/reset. Default recommendation: do not support resetting done items in v1.

## Dependencies

- None. This is a contained workflow/command feature on top of existing research lifecycle infrastructure.
- Related precedent: feature 242 (`fix-feature-reset-engine-state-cleanup`) established the engine-owned reset pattern for features.

## Out of Scope

- Resetting feedback items or generalizing all entities onto one reset command.
- Reopening or undoing completed research in `05-done` unless explicitly added to the lifecycle design.
- Large-scale dashboard redesign beyond adding the research reset action and confirmation plumbing needed to route to the correct command.
- Changing the structure/content of research findings files beyond deleting them during reset.
- Refactoring all session-close logic unless a small extraction is needed to support shared cleanup safely.

## Open Questions

- Should `research-reset` be available from `06-paused` and `04-in-evaluation` only, or also from `03-in-progress` and review-related transient states? Recommendation: any non-done state that represents started work.
- Should done research be resettable? Recommendation: no, not in v1.
- Is there an existing dashboard path already misrouting research reset to `feature-reset`, or is the bug only conceptual/missing-command? Implementation should verify and fix whichever path exists.

## Related

- [`lib/commands/feature.js`](</Users/jviner/src/aigon/lib/commands/feature.js>) — existing `feature-reset` reference implementation
- [`lib/commands/research.js`](</Users/jviner/src/aigon/lib/commands/research.js>) — add `research-reset`
- [`lib/workflow-core/engine.js`](</Users/jviner/src/aigon/lib/workflow-core/engine.js>) — add `resetResearch`
- [`lib/workflow-core/types.js`](</Users/jviner/src/aigon/lib/workflow-core/types.js>) — add `ManualActionKind.RESEARCH_RESET`
- [`lib/research-workflow-rules.js`](</Users/jviner/src/aigon/lib/research-workflow-rules.js>) — expose dashboard action
- [`lib/workflow-snapshot-adapter.js`](</Users/jviner/src/aigon/lib/workflow-snapshot-adapter.js>) — map action to `research-reset`
- [`AGENTS.md`](</Users/jviner/src/aigon/AGENTS.md>) — command inventory and reset guidance
