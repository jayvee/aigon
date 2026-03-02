# Research Findings: auto install

**Agent:** Codex (cx)
**Research ID:** 07
**Date:** 2026-03-02

---

## Key Findings

1. Aigon already has per-repo version state and update mechanics, but no cross-repo orchestration.
- `aigon` tracks installed version in `.aigon/version` and compares it against CLI `package.json` version (`aigon-cli.js`).
- `aigon update` re-syncs templates and re-runs `install-agent`, then suggests committing changed files.
- There is no explicit dirty-worktree/default-branch safety gate before writing files.

2. Aigon already has a global registry pattern that can be reused for push updates.
- Current global registry (`~/.aigon/ports.json`) stores repo paths and metadata (`registerPort`, `loadPortRegistry`, `savePortRegistry`).
- This can be generalized to a repo update registry for `aigon update --all`.

3. Pull-model startup hooks are viable in Claude Code, Cursor, and Gemini CLI.
- Claude Code supports `SessionStart` hooks.
- Cursor now documents hooks including `sessionStart` / `sessionEnd` and command hooks.
- Gemini CLI hooks include `SessionStart`, `BeforeAgent`, `BeforeTool`, `SessionEnd`, etc.
- Inference: these are the strongest trigger points for auto version checks in active repos.

4. Codex is the outlier for pull-model startup.
- Codex docs expose config and slash-command locations, plus `check_for_update` (for Codex itself), but no documented user `SessionStart` hook system.
- Inference: Codex pull automation likely needs a shell wrapper (`codex` launcher script), `direnv`, or fallback to push model.

5. npm/git hook-based triggers are viable, but they solve different moments.
- npm lifecycle hooks (`prepare`, `postinstall`, etc.) run around install/package operations, not every agent session.
- Git hooks (`post-merge`, `post-checkout`, `pre-commit`) are useful for consistency enforcement/checks.
- Inference: useful as secondary safeguards, not primary anti-drift mechanism.

6. Generated files should remain committed (project-local) for current Aigon architecture.
- Aigon docs explicitly note generated config files should be committed so new worktrees have agent configs.
- Trade-off: committed artifacts can drift, but enable reproducible worktrees and offline/isolated branches.
- Recommendation: keep committed project-local artifacts; avoid switching to runtime-only ephemeral files for now.

7. Version source abstraction is required for local npm, npm registry, and GitHub-backed consumers.
- Viable sources:
  - local CLI package version (`aigon --version` / `package.json`)
  - npm registry (`npm view aigon version`, defaults to `latest`)
  - GitHub release (`/repos/{owner}/{repo}/releases/latest`)
  - GitHub tags fallback (`/repos/{owner}/{repo}/tags`)
  - raw `package.json` fetch fallback
- Inference: define a pluggable `VersionSource` interface and resolve by install mode.

8. GitHub rate-limit-safe remote checking is straightforward with cache + conditional requests.
- Unauthenticated REST calls: 60/hour; authenticated: 5,000/hour.
- Conditional requests (ETag / `If-None-Match`) returning `304` do not count against primary rate limit.
- Recommendation: cache latest-version lookup (e.g., 6-24h TTL) and always revalidate with ETag when cache is stale.

9. Push model (`aigon update --all`) is feasible and useful even if pull model is primary.
- Adds one-command fleet sync across known repos.
- Best with per-repo safety statuses: `updated`, `skipped-dirty`, `skipped-branch`, `failed`.
- Inference: push mode is strong for maintainers after releasing a new Aigon version.

10. Minimal viable approach with least architectural change:
- Implement pull auto-checks first on agent `SessionStart` for Claude/Cursor/Gemini.
- Add push fallback `aigon update --all` using a global repo registry.
- Add per-repo policy in `.aigon/config.json`:
  - `update.mode`: `auto | prompt | manual`
  - `update.pin`: semver range or exact
  - `update.versionSource`: `npm | github-release | github-tags | local`
- Auto-apply only when safe (clean managed files + default branch), else notify and skip.

## Sources

- Aigon code and docs (local):
  - `aigon-cli.js` (`.aigon/version`, update flow, global registry): `/Users/jviner/src/aigon/aigon-cli.js`
  - `docs/GUIDE.md` generated-files guidance: `/Users/jviner/src/aigon/docs/GUIDE.md`
- Claude Code hooks:
  - https://docs.anthropic.com/en/docs/claude-code/hooks
- Cursor hooks and rules:
  - https://cursor.com/docs/agent/hooks
  - https://cursor.com/docs/context/rules
- Gemini CLI hooks and extensions:
  - https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/hooks/writing-hooks.md
  - https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/extensions/index.md
  - https://raw.githubusercontent.com/google-gemini/gemini-cli/main/docs/extensions/writing-extensions.md
- Codex docs:
  - https://developers.openai.com/codex/config
  - https://developers.openai.com/codex/cli
- npm lifecycle and version query:
  - https://raw.githubusercontent.com/npm/cli/latest/docs/lib/content/using-npm/scripts.md
  - https://raw.githubusercontent.com/npm/cli/latest/docs/lib/content/commands/npm-view.md
- Git hooks:
  - https://git-scm.com/docs/githooks
- Comparable tooling patterns:
  - Husky: https://typicode.github.io/husky/get-started.html
  - lint-staged: https://github.com/lint-staged/lint-staged
  - Prettier install/version pinning: https://prettier.io/docs/install.html
  - ESLint shareable configs: https://eslint.org/docs/latest/extend/shareable-configs
- GitHub version/rate-limit APIs:
  - Latest release endpoint: https://docs.github.com/en/rest/releases/releases#get-the-latest-release
  - Tags endpoint: https://docs.github.com/en/rest/repos/repos#list-repository-tags
  - REST rate limits: https://docs.github.com/en/rest/using-the-rest-api/rate-limits-for-the-rest-api
  - Conditional requests: https://docs.github.com/en/rest/using-the-rest-api/best-practices-for-using-the-rest-api#use-conditional-requests-if-appropriate

## Recommendation

Adopt a **hybrid pull+push model**, with pull as default:

1. Pull default: add `aigon self-check` and trigger it from agent `SessionStart` hooks (Claude, Cursor, Gemini).
2. Safe auto-apply: `self-check --auto` runs `aigon update` only when:
   - repo is on default branch (or user-configured allowed branch), and
   - no uncommitted changes in Aigon-managed paths.
3. Non-safe state behavior:
   - print actionable notice with exact reason (`dirty`, `non-default-branch`, `pinned-version`),
   - optionally queue reminder in `.aigon/state.json`.
4. Push complement: add `aigon update --all` to update all registered repos from one command.
5. Version source abstraction:
   - resolve latest via configured source (`npm` default, GitHub release/tags fallback),
   - cache with ETag + TTL to avoid API abuse.
6. Keep project-local generated files committed for now (worktree reliability), while treating global/user-level files (e.g., Codex global prompts) as user-managed artifacts.

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
| version-source-abstraction | Add a pluggable latest-version resolver (`npm`, `github-release`, `github-tags`, `local`) with per-repo config. | high | none |
| version-check-cache | Cache remote version checks with TTL + ETag/If-None-Match support. | high | version-source-abstraction |
| self-check-command | Add `aigon self-check` to detect mismatch and report/apply updates according to policy. | high | version-source-abstraction |
| startup-hooks-integration | Generate/maintain SessionStart hook wiring for Claude/Cursor/Gemini that calls `aigon self-check`. | high | self-check-command |
| safe-auto-update-guards | Add dirty-worktree/default-branch guards and structured skip reasons before auto-update. | high | self-check-command |
| repo-update-registry | Track Aigon-enabled repos in a global registry for bulk operations. | medium | none |
| update-all-command | Add `aigon update --all` to push updates across registered repos with per-repo status output. | medium | repo-update-registry |
| pinning-policy | Add `.aigon/config.json` update policy (`mode`, `pin`, `versionSource`) to control auto-install behavior. | medium | self-check-command |
| codex-launcher-helper | Provide optional wrapper/alias tooling for Codex users (no documented SessionStart hooks) to run self-check on launch. | medium | self-check-command |
| drift-reporting | Add `aigon doctor --updates` to show which repos are behind and why they were skipped. | low | repo-update-registry |
