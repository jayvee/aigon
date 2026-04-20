# Feature: codex-awaiter-approval-bypass

## Summary
When codex (`cx`) runs an Aigon feature autonomously, it frequently halts on an "Approval needed in <agent> [awaiter]" prompt while trying to run subsequent shell commands through codex's multi-agent "awaiter" sub-agent feature. These prompts appear even though:

- `approval_policy = "never"` is set globally in `~/.codex/config.toml`
- `sandbox_mode = "danger-full-access"` is set
- The project path AND the specific worktree path both have `trust_level = "trusted"` entries (verified on 2026-04-20: the F282 worktree `~/.aigon/worktrees/aigon/feature-282-cx-fix-entity-submit-silent-signal-loss` is in the config at line 2049, yet cx still prompted for awaiter approval during the run).

The awaiter / multi-agent gate is a separate approval mechanism that the documented top-level flags don't cover. When autonomous features hit it, AutoConductor polls forever waiting for a submit that never comes, cx's weekly rate limits tick down while it sits idle, and the user has to manually attach and approve.

This feature figures out the right configuration (or code change) to make codex awaiters run without prompting in Aigon-managed worktrees and rolls it out so existing and future worktrees are covered without per-feature intervention.

## User Stories
- [ ] As a developer running autonomous Aigon features with cx, my agent never halts on "Approval needed in <X> [awaiter]" — it completes the workflow and submits without me having to attach and approve.
- [ ] As the AutoConductor, when I spawn a cx review or implementation session, I can rely on the session reaching `submitted` within its normal window rather than stalling indefinitely on an internal codex gate.
- [ ] As a new-repo onboarder, when I run `aigon install-agent cx`, the resulting config makes all subsequent worktrees run awaiter-driven tool calls without prompts.

## Acceptance Criteria
- [ ] The exact config setting (or combination) that silences codex awaiter / multi-agent approval prompts is identified and documented in `docs/agents/cx.md`.
- [ ] `aigon install-agent cx` writes that setting into the project's `.codex/config.toml` (or the equivalent location) so every repo gets it automatically.
- [ ] `lib/worktree.js` worktree-setup or a new helper writes any per-path variant (e.g., the `[projects."<worktree>"]` trust entry) to `~/.codex/config.toml` at worktree creation, and removes it at worktree cleanup (feature-close, feature-reset).
- [ ] A one-time backfill migration populates entries for all currently-existing aigon worktrees (enumerate under `~/.aigon/worktrees/**` and append trust entries if missing).
- [ ] Regression test: spawn cx in a fresh aigon-managed worktree running a command that would normally trigger awaiter approval (e.g., a multi-step shell task), and assert the session completes without a prompt. If a full integration test is impractical, fall back to an assertion that the config file contains the required keys after `install-agent cx` + worktree creation.
- [ ] `CLAUDE.md` / `docs/agents/cx.md` updated to explain the awaiter gate, the fix, and the maintenance expectation.

## Validation
```bash
node -c lib/worktree.js
node -c lib/commands/setup.js
npm test
bash scripts/check-test-budget.sh
```

## Technical Approach

### What we know (confirmed live on 2026-04-20 during F282)
- F282's worktree was in the trust list (`~/.codex/config.toml` line 2049) and still hit "Approval needed in Ash [awaiter]".
- `approval_policy = "never"` and `sandbox_mode = "danger-full-access"` are both set globally.
- `[mcp_servers.playwright]` uses `default_tools_approval_mode = "approve"` — that pattern already works for MCP tool calls.
- `[features] multi_agent = true` is enabled, which is what enables awaiter sub-agents.
- cx's session output clearly showed the prompt was for an awaiter-driven shell command ("Run /review on my current changes" via `Ash [awaiter]`), not an MCP tool.

### What we need to find out
- Does codex expose a config flag that auto-approves awaiter / multi-agent tool calls? Candidates to investigate:
  - `default_tools_approval_mode` applied at the top level (not just per MCP server)
  - A `[awaiters]` or `[multi_agent]` block with its own approval setting
  - `--dangerously-bypass-approvals-and-sandbox` on the cx CLI — already added by `lib/config.js:879-890` for autonomous mode; verify whether it's actually being passed when AutoConductor spawns the session
  - An env var (e.g., `CODEX_APPROVE_ALL`, `CODEX_AUTO_APPROVE`)
- If no documented flag exists, file an upstream codex issue and choose a workaround (e.g., don't use awaiters; have cx run commands directly; fall back to cc for autonomous flows).

### Likely fix shape
1. **Config investigation** — run a short research task (or spec research) checking codex docs and config-schema for awaiter approval keys. Document findings in the spec before implementation.
2. **Project config update** — once the key is identified, add it to the `.codex/config.toml` template in `templates/` and re-run `aigon install-agent cx` during `aigon update`.
3. **Worktree registration** — add `registerCodexTrust(worktreePath)` to `lib/worktree.js` that idempotently appends `[projects."<path>"] trust_level = "trusted"` to `~/.codex/config.toml` and optionally any awaiter/approval override. Call it from worktree-creation sites (`lib/commands/feature.js:1117` and wherever worktrees are built for research / evals). Mirror with `unregisterCodexTrust` at cleanup.
4. **Backfill migration** — on `aigon update`, walk `~/.aigon/worktrees/**` two levels deep and append entries for any missing paths. Idempotent (skip entries that already exist).
5. **Autonomous-mode verification** — confirm that AutoConductor-spawned cx sessions receive `--dangerously-bypass-approvals-and-sandbox` in practice; if not, fix the launch path.

### Why this isn't just "trust more paths"
F282 was already trusted and still prompted. The trust list stops the codex "Trust this project?" first-run gate but does not disable awaiter approval. Solving it requires finding and applying the awaiter-specific setting, not adding more trust entries — although entry auto-registration is still worth doing because it removes a per-worktree "click Trust" moment for new worktrees.

## Dependencies
- None hard. `feature-fix-entity-submit-silent-signal-loss` (F282) is unrelated but surfaced the problem.

## Out of Scope
- Any codex-internal changes (this is a wrapping / configuration problem in Aigon, not a codex fork).
- Fixing awaiter approval for non-autonomous interactive sessions where the user genuinely wants to see prompts.
- Generalising beyond codex — other agents (cc, gg, cu) have their own approval models and are covered separately.
- Removing the `[mcp_servers.playwright] default_tools_approval_mode = "approve"` pattern — that already works; we just extend the same idea to awaiters.

## Open Questions
- Is the right config key on the TOP-LEVEL (like `approval_policy`) or per-feature (like `[features] multi_agent_approval_mode = "auto"`)? Needs codex docs / schema check.
- Does codex expose an env var that overrides awaiter approval at runtime? (Would be simpler than editing config.)
- Should this live in `aigon install-agent cx` (per-project) or `aigon update` global migration (per-machine), or both?
- If no codex-side config exists, is the right move to stop using awaiters in autonomous flows and refactor cx's launch to avoid them? (Would avoid the approval entirely at the cost of some flexibility.)

## Related
- Triggered by: 2026-04-20 F282 autonomous run — cx's `do-cx` session halted ~17 min on `! Approval needed in Ash [awaiter]` during autonomous implementation, consuming weekly rate limit while idle.
- Related memory: `reference_codex_mcp_approval.md` — "approval_policy/sandbox_mode don't cover MCP tool calls; use default_tools_approval_mode = "approve" per [mcp_servers.*]" — same class of issue but for MCP servers; this feature extends the same principle to awaiters.
- CLAUDE.md § "Autonomous mode" in lib/config.js — already filters out `--full-auto` and prepends `--dangerously-bypass-approvals-and-sandbox`; that patch stopped some prompts but not this class.
