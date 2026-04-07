# Feature: rename AI attribution emails from aigon.dev to aigon.build

## Summary
Aigon stamps every commit by an AI agent with a synthetic email like `cc@aigon.dev`, `gg@aigon.dev`, `cx@aigon.dev` for AI attribution / metrics. The project domain is **aigon.build**, not aigon.dev — the mismatched domain looks like a branding inconsistency in public commit history and could become an actual problem if aigon.dev gets registered by someone else. This feature renames the synthetic email domain from `@aigon.dev` to `@aigon.build` going forward, keeps regex compatibility for historical commits, and adds a config option so future renames don't require a code change.

## Background

The synthetic emails are set in `lib/worktree.js` when a worktree is created for an agent (`git config --local user.email cc@aigon.dev`). The matching regex in `lib/agent-registry.js` (`getAgentEmailRegex()`) is what downstream attribution analytics use to identify "this commit was AI-authored".

The `@aigon.dev` domain was an early choice. The project domain has since stabilised on `aigon.build`. Existing commits in git history use `@aigon.dev` and we don't want to rewrite history (too invasive, breaks SHAs, would force-push the entire repo) — but new commits should use the brand-correct domain.

## User Stories

- [ ] As a visitor browsing the public GitHub repo's commit history, I see AI commits attributed to `cc@aigon.build` (matching the project domain) instead of an unrelated `aigon.dev` domain
- [ ] As a maintainer running `git log --author=@aigon.build`, I see all NEW AI commits — without the regex change, this query would miss everything
- [ ] As a maintainer running historical metrics analysis, I see ALL AI commits including legacy `@aigon.dev` ones — the regex matches both domains
- [ ] As a future maintainer who wants to change the brand again, I can set `aiAttributionDomain` in config without editing source code

## Acceptance Criteria

- [ ] **AC1** — `lib/worktree.js` writes `<agentId>@aigon.build` (not `@aigon.dev`) when configuring a worktree's local git user.email
- [ ] **AC2** — Both code paths in `worktree.js` are updated: the `agentEmail` constant (line ~1036) AND the bash heredoc fallbacks (lines ~1074, ~1095) that compute `AGENT_EMAIL` for shell-based attribution
- [ ] **AC3** — `lib/agent-registry.js` `getAgentEmailRegex()` matches BOTH legacy `@aigon\.dev` and new `@aigon\.build` so historical attribution analysis still works. New regex shape: `^(${ids})(?:\+[-\w.]+)?@aigon\.(dev|build)$`
- [ ] **AC4** — A new config field `aiAttributionDomain` is added to `lib/config.js` defaulting to `aigon.build`. When set, `worktree.js` reads it instead of hardcoding the domain. The regex in `agent-registry.js` reads the domain from config and joins both legacy + current values for matching.
- [ ] **AC5** — The user-facing log message in `worktree.js` (line ~1142, `🏷️  Git attribution enabled (...@aigon.dev, trailers + notes)`) reflects the new domain
- [ ] **AC6** — Existing telemetry / metrics tests (if any reference the `@aigon.dev` regex) still pass — the regex compat with both domains keeps them green
- [ ] **AC7** — A new regression test asserts the regex matches both `cc@aigon.dev` (legacy) and `cc@aigon.build` (new). REGRESSION comment names this feature.
- [ ] **AC8** — `git log --author=@aigon.build` returns at least one commit after the feature lands (the verification step itself), proving the new domain is in use
- [ ] **AC9** — Documentation (`docs/architecture.md`, `docs/agents/*.md`, any guide pages) updated to reflect the new domain. Don't rewrite historical references.
- [ ] **AC10** — `docs/specs/features/MOVED-TO-AIGON-PRO.md` and any other split-related notes don't need updating (they don't reference the email domain).

## Validation
```bash
node --check lib/worktree.js
node --check lib/agent-registry.js
node --check lib/config.js
npm test
# Manually verify regex matches both:
node -e "const r = require('./lib/agent-registry.js').getAgentEmailRegex(); console.log(r.test('cc@aigon.dev'), r.test('cc@aigon.build'));"
```

## Technical Approach

### 1. Add the config field

`lib/config.js` — extend `DEFAULT_GLOBAL_CONFIG` (or wherever the defaults live) with:
```js
aiAttributionDomain: "aigon.build"
```

Add a getter `getAttributionDomain()` that returns the config value or the default.

### 2. Update `lib/worktree.js`

Three changes:
- Line ~1036: replace hardcoded `@aigon.dev` with the config-derived domain
- Lines ~1074 and ~1095: the bash heredoc fallbacks need the same — pass the domain through as an environment variable so the heredoc can read it
- Line ~1142: log message reflects the actual domain in use

### 3. Update `lib/agent-registry.js`

Change `getAgentEmailRegex()` to match both domains:
```js
function getAgentEmailRegex() {
    const ids = getAgentEmailIds().join('|');
    // Match both legacy aigon.dev and current aigon.build for historical compat
    return new RegExp(`^(${ids})(?:\\+[-\\w.]+)?@aigon\\.(dev|build)$`, 'i');
}
```

If we want full config-driven flexibility, the regex could read from config and union legacy + current — but a hardcoded `(dev|build)` is simpler and matches the actual states the world is in. Keep it simple.

### 4. Update touched docs

Grep for `@aigon.dev` in `docs/architecture.md`, `docs/agents/*.md`, any guide pages, and update to `@aigon.build`. Leave historical CHANGELOG entries and spec logs alone.

```bash
grep -rln "@aigon\.dev\|aigon\.dev" docs/ site/content/ README.md AGENTS.md CLAUDE.md
```

### 5. Test

- Add a unit test for the regex compat (matches both domains)
- Run full suite
- Manual verification: create a throwaway worktree with `aigon afs <id> cc`, make a commit, confirm the author email is `cc@aigon.build`

### 6. Commit

Single commit, clear message explaining the rename + the regex compat strategy. No history rewrite — historical `@aigon.dev` commits stay as-is.

## Out of Scope

- **Rewriting historical commits** to change their author email from `@aigon.dev` → `@aigon.build`. Too invasive, breaks all SHAs, requires force-push, no tangible benefit beyond cosmetic. The regex compat covers the metrics-analysis case.
- **Setting up email forwarding** for `cc@aigon.build` etc. The synthetic emails are markers, not real mailboxes — no actual mail is ever sent or expected.
- **Acquiring the `aigon.dev` domain** to control it. Out of scope for this feature; if it matters, do it as a separate domain-acquisition task.
- **Changing the agent ID prefix scheme** (cc, gg, cx, cu). Just the domain.

## Open Questions

- Should the config key be `aiAttributionDomain` or `gitAttributionDomain` or just `attributionDomain`? Recommend `aiAttributionDomain` — most explicit about what it's for.
- Do we want to allow `null` to mean "disable AI attribution entirely"? Recommend yes — some users won't want their commits stamped with synthetic emails. Backward-compatible default is the current behaviour (stamping enabled).
- Should the regex always include `aigon.dev` for compat, or only when there are commits in history with that domain? Always include — the maintenance cost is zero and removing it later is risky.

## Related

- Discovered during the 2026-04-07 site audit before launch
- `lib/worktree.js` — where the synthetic email is set per-worktree
- `lib/agent-registry.js` — the regex consumer
- `lib/config.js` — where the new config field lives
- Future research-19 / metrics-code-durability features depend on accurate AI attribution
- Sister concern: bug where AI attribution config bled into the main repo's `.git/config` (resulting in human commits being authored as Claude). That's a separate bug — also worth fixing, but tracked separately.
