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

Each worktree gets its own port and, when Caddy is configured, a named URL:
- Main repo: `http://aigon.test`
- Worktree `feature-73-cc-...`: `http://cc-73.aigon.test`

Use `node aigon-cli.js dashboard list` to see all running instances. Falls back to `localhost:PORT` if Caddy is not set up.

## Testing

**IMPORTANT: Read `docs/architecture.md § Testing` for the full guide.** Pick the right tests for what you changed:

    npm test                          # Default: unit + manifest + dashboard UI (always run before submitting)
    npm run test:e2e:mock-solo        # After changes to feature lifecycle (setup/close/submit)
    npm run test:e2e:mock-fleet       # After changes to fleet mode or multi-agent logic
    npm run test:dashboard            # After dashboard HTML/JS/CSS edits
    npm run test:dashboard:e2e        # After dashboard + lifecycle changes together
    node -c aigon-cli.js              # Quick syntax check
    node -c lib/<module>.js           # Quick syntax check for a module

**Minimum before submitting:** `npm test` must pass. If you changed lifecycle commands, also run the relevant mock E2E test.

## Versioning

After every commit, ask the user if a version bump is needed:
- `patch` — bug fixes only
- `minor` — new features, backwards compatible
- `major` — breaking changes

Run `npm version <type>` to bump, then `git push && git push --tags`.
<!-- AIGON_START -->
## Aigon

This project uses the Aigon development workflow.

- Agent-specific notes: `docs/agents/*.md`
- Architecture overview: `docs/architecture.md`
- Development workflow: `docs/development_workflow.md`
<!-- AIGON_END -->
