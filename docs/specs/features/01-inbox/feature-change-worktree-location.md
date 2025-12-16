# Feature Spec: Global Worktree Root for Aigon

## Summary

Aigon currently creates Git worktrees as sibling directories to the active repository
(e.g. `../feature-58-cc-*`). This causes repeated macOS permission prompts and creates
friction when running multiple agents in parallel.

This change introduces a **global, stable worktree root** managed entirely by Aigon
itself, without requiring any configuration files in the target project repository.

All Aigon-managed worktrees will be created under a single, predictable directory in
the user’s home workspace.

---

## Problem Statement

### Current behavior
- Aigon creates worktrees as sibling directories to the current working directory.
- Each new worktree appears in a different filesystem location relative to the repo.
- On macOS, this frequently triggers permission prompts for:
  - Terminal / Warp
  - Editors (VS Code)
  - AI agent host applications
- Parallel development multiplies this friction.

### Constraints
- Aigon should remain **repo-agnostic**.
- No `.aigon/` folder or config files should be introduced into target repositories.
- The solution must work consistently across commands (`feature-start`, `bakeoff-implement`, cleanup).
- Cleanup must remain safe and deterministic.

---

## Design Goals

1. **Stable filesystem location**
   - All worktrees live under a single parent directory.
   - Permissions are granted once, not repeatedly.

2. **Zero repo pollution**
   - No new files or folders added to the target project repository.

3. **Predictable + discoverable**
   - Users can easily find where Aigon places worktrees.
   - Paths are printed when worktrees are created.

4. **Safe cleanup**
   - Aigon can reliably locate and remove worktrees it created.

---

## Proposed Solution

### Global Worktrees Root

Aigon will create all worktrees under a global directory:

```
~/.aigon-worktrees/<repo-name>/<worktree-name>
```

Where:
- `<repo-name>` is derived from the git root directory name.
- `<worktree-name>` follows Aigon’s existing naming conventions
  (e.g. `feature-58-cc-dark-mode`).

This directory is:
- outside the repo (avoids recursive watchers),
- stable across runs,
- hidden by default (dot-folder).

### Environment Variable Override

Aigon will support a single optional environment variable:

```
AIGON_WORKTREES_DIR
```

If set, Aigon will use:

```
$AIGON_WORKTREES_DIR/<repo-name>/<worktree-name>
```

instead of the default `~/.aigon-worktrees`.

This provides flexibility without introducing repo-local config.

---

## Detailed Behavior

### Worktree Creation

When Aigon creates a worktree:

1. Determine worktrees root:
   - If `AIGON_WORKTREES_DIR` is set, use it.
   - Else use `~/.aigon-worktrees`.

2. Determine repo namespace:
   - Use the git root directory name as `<repo-name>`.

3. Ensure directory exists:
   - `mkdir -p <worktrees-root>/<repo-name>`

4. Create the worktree using Git:
   - `git worktree add <full-path> <branch-name>`

5. Print output:
   - Worktrees root path
   - Full path of the created worktree

### Example

```
Worktrees root: ~/.aigon-worktrees/aigon
Created worktree: ~/.aigon-worktrees/aigon/feature-58-cc-dark-mode
```

---

## Cleanup Behavior

Cleanup logic must not rely on stored metadata files.

Aigon will use one of the following safe mechanisms:

- Deterministic path reconstruction based on:
  - feature ID
  - agent
  - repo name
- Or Git-native discovery:
  - `git worktree list --porcelain`

Cleanup commands will:
- Only remove worktrees under the configured worktrees root.
- Never delete arbitrary directories outside that root.

---

## Non-Goals

- No plugin system introduced.
- No repo-local `.aigon` directory.
- No automatic permissions management (handled by OS/user).
- No changes to Git itself or Git worktree semantics.

---

## Migration Notes

- Existing sibling worktrees will continue to function.
- New worktrees will use the global root.
- Cleanup commands should handle both old and new locations during transition.

---

## Risks and Mitigations

### Risk: user confusion about worktree location
Mitigation:
- Always print the worktrees root and full path.
- Document the behavior clearly in Aigon docs.

### Risk: name collisions across repos
Mitigation:
- Namespace by `<repo-name>` under the worktrees root.

---

## Open Questions (Future)

- Should Aigon support an interactive `aigon doctor` command to show worktree locations?
- Should remote repo name (e.g. `owner/repo`) be used instead of local folder name?
- Should cleanup warn if untracked files exist in a worktree?

---

## Acceptance Criteria

- Running `aigon bakeoff-implement` creates worktrees under a single stable directory.
- No new files are added to the target repository.
- Repeated macOS permission prompts are eliminated.
- Cleanup works reliably and safely.
