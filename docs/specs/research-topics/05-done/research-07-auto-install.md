# Research: auto-install

## Context

When Aigon is updated (new features, bug fixes, template changes) in this repo, every repository that uses Aigon must be manually visited to run `aigon update`, and the resulting changes must be committed into each repo. With five or six active repositories, this is error-prone: repos can fall behind, run different Aigon versions, and require manual effort to stay in sync.

The current flow is:
1. Make a change in this repo.
2. Agent in this repo updates Aigon globally (`npm update -g aigon`)
3. `cd` into each project repo
4. Run `aigon update` to regenerate command files in the command line
5. Typically run an ai agent in that repo, and ask it to commit the regenerated files
6. Repeat for every repo

This creates version drift, forgotten repos, and unnecessary friction. We need a mechanism — either push-based (Aigon pushes updates to all known repos) or pull-based (repos auto-detect and install updates when an agent starts) — that eliminates this manual loop entirely.

## Questions to Answer

- [x] What are all the viable trigger points for auto-install?
- [x] For a **pull model**: can we hook into agent startup to check Aigon version and auto-update?
- [x] For a **push model**: can Aigon push updates to all known repos from a single command?
- [x] Should generated command files remain committed or be ephemeral?
- [x] How should version pinning work?
- [x] What happens when auto-install runs with uncommitted changes or on a feature branch?
- [x] Can we leverage npm/node mechanisms?
- [x] How do other CLI-based dev tools solve this?
- [x] How should version checking work for remote/GitHub-hosted Aigon?
- [x] What is the right abstraction for a version source?
- [x] How do we cache remote version checks?
- [x] What is the minimal viable approach?

## Scope

### In Scope
- Mechanisms to auto-detect Aigon version mismatch and trigger updates
- Push vs pull architecture comparison
- Agent-specific hook points for triggering updates (Claude Code, Cursor, Gemini CLI, Codex)
- Whether generated files should be committed or ephemeral
- Version pinning and compatibility strategies
- Conflict avoidance when auto-updating in active repos
- Registry of Aigon-enabled repos
- **Remote version resolution**: checking latest Aigon version against GitHub (tags/releases/package.json) when Aigon is not installed locally or is consumed via `npx`/clone

### Out of Scope
- Changes to the template system itself (that's a separate concern)
- MCP server distribution (covered by plugin-distribution research)
- Aigon marketplace/plugin packaging
- Multi-user or team sync scenarios (focus on single-developer workflow)

## Inspiration

- **Husky**: Installs git hooks via `prepare` npm script — runs automatically on `npm install`
- **direnv**: Auto-loads environment when entering a directory — could inspire directory-aware triggers
- **Claude Code SessionStart hook**: Could check Aigon version and run update before any command
- **npm `prepare` / `postinstall` scripts**: Auto-run on dependency install
- **Homebrew autoupdate**: Background scheduled updates with `brew autoupdate`

## Recommendation

**Keep it simple: local version comparison + SessionStart hooks.**

Both agents agreed that SessionStart hooks (supported by Claude Code, Cursor, and Gemini CLI) are the strongest trigger point. Both agreed generated files should stay committed. Both agreed a layered approach starting with the simplest possible mechanism.

The minimal solution is two things:
1. **`aigon check-version`** — compares the version stamp in `.aigon/version` against the locally installed CLI version (`aigon --version`). If they differ, runs `aigon update` to regenerate files. No network calls, no remote checking, no caching.
2. **SessionStart hook wiring** — `aigon install-agent` writes a SessionStart hook for each agent (cc, cu, gg) that calls `aigon check-version` on every session start.

This eliminates version drift with ~50 lines of code. Every time an agent starts in a project, it checks if generated files match the installed CLI. If not, it updates them automatically. No manual `aigon update` needed.

Remote version checking (GitHub, npm) and push-model (`aigon update --all`) are deferred as future enhancements if needed.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| auto-version-check | `aigon check-version` command comparing `.aigon/version` vs CLI version (auto-updating if stale), plus SessionStart hook wiring in `install-agent` for cc/cu/gg | high | `aigon feature-create "auto-version-check"` |

### Not Selected
- version-source-abstraction: Over-engineered for current needs; local comparison is sufficient
- version-check-cache: No remote calls, so no caching needed
- project-registry: Not needed without push model
- update-all-command: Deferred; pull model covers the primary use case
- pinning-policy: Deferred; always-track-latest is fine for single developer
- generated-file-markers: Not needed if hooks keep files current
- gitattributes-merge-driver: Over-engineered; regeneration via hooks is simpler
- drift-reporting: Not needed without registry
- codex-launcher-fallback: Codex has no hooks; address if/when it gets them
- ephemeral-mode: Both agents recommended against it
