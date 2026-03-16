# Feature: committed-project-agent-instructions

## Summary

Project-specific agent instructions (e.g. "how to restart the dashboard", "how to run tests for this project") are currently stored only in the scaffold section of `CLAUDE.md` / `AGENTS.md`, which are gitignored. This means a fresh clone, a new worktree, or a new contributor gets empty scaffolding — losing all project-specific context. This is a significant cause of agent ineffectiveness when working on Aigon-on-Aigon: each new worktree agent starts without knowing how to build, test, or run the project's own tooling.

This feature introduces a committed project instructions file (`docs/aigon-project.md`) that `install-agent` reads and prepends to the generated `CLAUDE.md`/`AGENTS.md` above the `<!-- AIGON_START -->` marker. Project-specific instructions are now versioned, shared across worktrees, and survive fresh clones.

## User Stories

- [ ] As a developer, when I set up a new worktree with `aigon feature-setup`, the agent in that worktree automatically receives the project's custom build/test/dashboard instructions without me having to manually add them.
- [ ] As a new contributor doing a fresh clone, running `aigon install-agent cc` produces a `CLAUDE.md` that includes the committed project instructions, not just an empty scaffold.
- [ ] As a developer, I can edit `docs/aigon-project.md`, commit it, and know that all future agent installs will pick up the updated instructions.

## Acceptance Criteria

- [ ] `aigon install-agent` checks for `docs/aigon-project.md` and, if present, prepends its content above the `<!-- AIGON_START -->` marker in the generated root file (`CLAUDE.md` or `AGENTS.md`)
- [ ] If `docs/aigon-project.md` does not exist, behaviour is unchanged (empty scaffold as today)
- [ ] The content from `docs/aigon-project.md` replaces the generic scaffold comment block (not appended after it)
- [ ] Re-running `install-agent` re-reads `docs/aigon-project.md` and updates the pre-marker content — it does not accumulate duplicate copies
- [ ] `aigon update` also re-reads `docs/aigon-project.md` when it re-runs `install-agent`
- [ ] `docs/aigon-project.md` is NOT gitignored (committed with the project)
- [ ] The aigon project itself ships a `docs/aigon-project.md` with accurate, current instructions covering: dashboard start/restart, test command, syntax check, template sync after editing commands

## Validation

```bash
node -c aigon-cli.js
node -c lib/utils.js
node -c lib/commands/shared.js
```

## Technical Approach

The change is minimal and contained in `install-agent` logic in `lib/commands/shared.js` and the scaffold generation in `lib/utils.js`.

**Current flow** (`install-agent` for a root-file agent like `cc`):
1. If `CLAUDE.md` does not exist: write `getScaffoldContent()` + marked content
2. If `CLAUDE.md` exists: call `upsertMarkedContent()` (preserves pre-marker content, updates marker block)

**New flow:**
1. Check for `docs/aigon-project.md` in the project root
2. If present, use its content as the pre-marker block instead of `getScaffoldContent()`
3. If not present, fall back to `getScaffoldContent()` (no change for projects without the file)
4. The `upsertMarkedContent` logic already handles the "update marker block, preserve pre-marker content" case for existing files. For the new file creation case, use the project file content instead of scaffold.
5. For existing files: update the pre-marker section too (replace between start-of-file and `<!-- AIGON_START -->`) so re-running `install-agent` stays in sync with `docs/aigon-project.md`.

**Key implementation detail:** `upsertMarkedContent` currently only updates the `<!-- AIGON_START --> ... <!-- AIGON_END -->` block and leaves everything before it untouched. A new helper (e.g. `upsertRootFile(filePath, projectContent, markerContent)`) should handle both zones:
- Zone 1 (pre-marker): replaced with `projectContent` (from `docs/aigon-project.md` or scaffold fallback)
- Zone 2 (marker block): replaced with `markerContent` (generated from template, as today)

**File to create in aigon project itself:** `docs/aigon-project.md` containing:

```markdown
# Claude Instructions for Aigon

## Developing Aigon

This is the Aigon library itself. When editing commands or templates:

- **Source of truth**: `templates/generic/commands/`
- **Working copies**: `.claude/commands/`, `.cursor/commands/`, etc. (gitignored, generated)

After editing templates, run `aigon update` or `aigon install-agent cc` to sync changes to the working copies.

## Dashboard Development

The dashboard is a foreground HTTP server (no daemon). Start it with:

    node aigon-cli.js dashboard

After editing `lib/utils.js` or any backend JS, restart the server (Ctrl+C + rerun).
`templates/dashboard/index.html` is read fresh per request — no restart for frontend changes.

Each worktree gets its own port (hash of branch → 4101–4199). Use `node aigon-cli.js dashboard list` to see all instances.

## Testing

    npm test                          # Run test suite
    node -c aigon-cli.js              # Quick syntax check
    node -c lib/utils.js              # Check shared module

## Versioning

After every commit, ask the user if a version bump is needed:
- `patch` — bug fixes only
- `minor` — new features, backwards compatible
- `major` — breaking changes

Run `npm version <type>` to bump, then `git push && git push --tags`.
```

## Dependencies

- No external dependencies
- Touches: `lib/utils.js` (`getScaffoldContent`, new `upsertRootFile` helper), `lib/commands/shared.js` (`install-agent` command handler)

## Out of Scope

- Making `CLAUDE.md` or `AGENTS.md` themselves tracked (they remain gitignored — the source of truth stays in `docs/aigon-project.md` + `templates/`)
- Supporting multiple project instruction files or per-agent overrides
- Auto-creating `docs/aigon-project.md` if it doesn't exist (let the user create it)

## Open Questions

- Should `aigon init` offer to create a `docs/aigon-project.md` stub? (Probably yes, low priority)

## Related

- Architecture: `docs/architecture.md`
- CLAUDE.md gitignore: `.gitignore` line 16
- `upsertMarkedContent` in `lib/utils.js`
- `install-agent` command in `lib/commands/shared.js` ~line 4391
