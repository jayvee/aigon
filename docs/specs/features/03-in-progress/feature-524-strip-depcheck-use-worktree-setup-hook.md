---
complexity: high
transitions:
  - { from: "inbox", to: "backlog", at: "2026-05-12T06:15:51.770Z", actor: "cli/feature-prioritise" }
---

# Feature: strip-depcheck-use-worktree-setup-hook

## Summary
Aigon currently injects a language-specific dependency-install recipe into the body of the `/aigon:feature-do` slash command via the `{{WORKTREE_DEP_CHECK}}` placeholder, sourced from `templates/profiles/{web,api,library,…}/dep-check.md`. The `web`/`api`/`library` profiles ship a Node recipe (`pnpm/yarn/bun/npm install`, in that hardcoded order). Every agent dutifully runs `npm install` as its first action in a fresh worktree — measured at 29–40s per worktree for a 360 MB `node_modules` tree (incident 2026-05-12, brewboard #09 dark-mode fleet start).

This violates Aigon's own zero-opinion rule (CLAUDE.md hot rule #10): Aigon must not know or guess the target repo's package manager, language, or setup commands. The correct primitive already exists — `projectConfig.worktreeSetup` in `.aigon/config.json` (`lib/profile-placeholders.js:180`, executed in `lib/worktree.js:2018-2027`). Delete the bad path; document the good one; retrofit John's active target repos so they keep working.

## User Stories
- [ ] As an Aigon operator on any stack (Rust, Python, Go, JS, static, mixed), Aigon does not inject any package-manager-specific commands into my agent's prompt.
- [ ] As an operator who needs per-worktree setup, I read one short doc section, set `"worktreeSetup": "<shell line>"` in `.aigon/config.json`, and `feature-start` runs it after `git worktree add` and before the agent launches.
- [ ] As John, fleet starts on brewboard, aigon, and aigon-pro complete in seconds instead of ~30s because their `worktreeSetup` symlinks `node_modules` instead of reinstalling.

## Acceptance Criteria
- [ ] The strings `WORKTREE_DEP_CHECK`, `depCheck`, `dep-check.md`, `pnpm install`, `yarn install`, `bun install`, `npm install`, "Worktrees do not share", "Install dependencies if needed" appear nowhere under `lib/`, `templates/generic/`, `templates/profiles/`, `templates/docs/`, `scripts/`, `docs/site/` (grep returns zero hits).
- [ ] `templates/profiles/{web,api,ios,android,library,generic}/dep-check.md` are deleted.
- [ ] `templates/profiles.json` no longer has a `depCheck` entry under `stringFiles`.
- [ ] `lib/profile-placeholders.js` no longer references `depCheck`: removed from `PROFILE_PRESET_STRING_FILES` (around line 36), removed from the resolved `profile` object (around line 193), and the `WORKTREE_DEP_CHECK` substitution (around lines 855–861) is gone.
- [ ] `lib/commands/infra.js` no longer has the `if (profile.depCheck) { … }` block (around line 1299).
- [ ] `templates/generic/commands/feature-do.md` no longer contains the `{{WORKTREE_DEP_CHECK}}` line (around line 42); the `processTemplate` 3+ newlines → 2 collapse leaves no orphan blank lines.
- [ ] After `aigon install-agent --all` in the aigon repo, none of the installed slash commands (`.claude/commands/aigon/feature-do.md`, `.gemini/…`, `.codex/…`, `.cursor/…`) contain a "Before Step 3: Install dependencies" block.
- [ ] Public docs gain a "Per-worktree setup (`worktreeSetup`)" section in: `docs/site/` (Configuration page), `templates/docs/development_workflow.md`, `README.md` (Configuration section), `AGENTS.md` (orientation, one paragraph + cross-link). Each section covers: **when it runs** (after `git worktree add`, before agent launch), **where to set it** (`.aigon/config.json`), **two examples** (`"npm ci"`; `"ln -s ../../node_modules node_modules"`), **failure semantics** (warn-and-continue, 120s timeout per `worktree.js:2022`), and an **anti-pattern note** ("Aigon does not detect or guess your stack").
- [ ] Brewboard `.aigon/config.json` gets `worktreeSetup` set (symlink preferred; fall back to `npm ci` if symlink breaks Next.js — verify during impl).
- [ ] Aigon's own `.aigon/config.json` gets `worktreeSetup` set if its worktrees need a working `node_modules` (likely yes — the dashboard server and tests run there).
- [ ] aigon-pro `.aigon/config.json` retrofitted with the same approach.
- [ ] A checklist of John's other repos under `~/src` is surfaced during impl; the implementer asks before touching anything outside brewboard/aigon/aigon-pro.
- [ ] Validation: after retrofit, a 2-agent fleet start on brewboard runs end-to-end in under 5s of CLI wall-clock (excluding agent boot time).

## Validation
```bash
grep -rn "WORKTREE_DEP_CHECK\|depCheck\|dep-check\.md" lib/ templates/generic/ templates/profiles/ templates/docs/ scripts/ docs/site/ 2>/dev/null && echo "FAIL: leftover references" || echo "OK"
ls templates/profiles/*/dep-check.md 2>/dev/null && echo "FAIL: dep-check.md still present" || echo "OK"
```

## Technical Approach
Single-pass cleanup. No migration step — `worktreeSetup` already works end-to-end.

1. **Delete the producers**
   - `rm templates/profiles/{web,api,ios,android,library,generic}/dep-check.md`
   - Edit `templates/profiles.json`: remove `"depCheck": "dep-check.md"` from `stringFiles`.
2. **Strip the wiring**
   - `lib/profile-placeholders.js`: remove `depCheck` from `PROFILE_PRESET_STRING_FILES`, from profile preset hydration, and remove the `WORKTREE_DEP_CHECK` substitution.
   - `lib/commands/infra.js`: remove the `if (profile.depCheck) …` block.
3. **Strip the consumer**
   - `templates/generic/commands/feature-do.md`: delete the `{{WORKTREE_DEP_CHECK}}` line and surrounding blank lines.
4. **Re-render the installed slash commands** in the aigon repo by running `aigon install-agent --all`. Other repos pick up the change on their next `aigon` upgrade.
5. **Public documentation** — add "Per-worktree setup (`worktreeSetup`)" to:
   - `docs/site/` Configuration / `.aigon` page (find the existing config-reference page)
   - `templates/docs/development_workflow.md`
   - `README.md`
   - `AGENTS.md`
6. **Retrofit operator configs** — brewboard, aigon, aigon-pro. Test each by running a single-agent feature-start and confirming the hook ran.
7. **Tests** — iterate gate must pass. If `lib/__tests__/profile-placeholders.test.js` exists, add an assertion that the resolved profile has no `depCheck` field; otherwise add a render-time assertion that the rendered `feature-do.md` output contains no "Install dependencies" string.

## Dependencies
- None. `worktreeSetup` already exists, is already wired (`lib/profile-placeholders.js:180`, `lib/worktree.js:2018`), and is already documented in the inline comment at `worktree.js:2015`.

## Out of Scope
- Parallelising the per-agent `agentIds.forEach` loop in `lib/feature-start.js:570` (separate feature — meaningful additional win on top of this one).
- Building a "smart" symlink/hardlink helper inside Aigon. That would re-introduce the language-opinionated path we are removing. If operators want symlinks they put `ln -s` in `worktreeSetup`.
- F522 optimistic-UI render bug (the card not moving on Start).
- Stale "Finished (unconfirmed)" / `clearSessionEndedFlag` bug.

## Open Questions
- Does brewboard tolerate `node_modules` as a symlink for Next.js dev/build? Verify before recommending the symlink form as the doc default; fall back to `npm ci` if not.
- Should `worktreeSetup` accept an array of commands or stay a single shell line? Default: single shell line. Operators can use `&&` for composition. Revisit only if an obvious need emerges during the retrofit.

## Related
- Research:
- Set:
- Prior features in set: F522 (optimistic-start-ui) — same incident; this is the deeper-root fix.
