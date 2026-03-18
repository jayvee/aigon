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

Each worktree gets its own port and, when aigon-proxy is running, a named URL:
- Main repo: `http://aigon.localhost`
- Worktree `feature-73-cc-...`: `http://cc-73.aigon.localhost`

Use `node aigon-cli.js dashboard list` to see all running instances. Falls back to `localhost:PORT` if aigon-proxy is not running (`aigon proxy start`).

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
<!-- AIGON_START -->
## Aigon

This project uses the Aigon development workflow.

- Shared project instructions: `AGENTS.md`
- Claude-specific notes: `docs/agents/claude.md`
- Development workflow: `docs/development_workflow.md`

<!-- AIGON_END -->
