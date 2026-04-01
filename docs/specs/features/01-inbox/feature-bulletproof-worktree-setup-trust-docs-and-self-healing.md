# Feature: Bulletproof Worktree Setup — Trust, Docs, and Self-Healing

## Summary

A new aigon user runs `aigon init` on their project, then `feature-start 1 cc`. A mysterious `myproject-worktrees/` directory appears next to their project. Claude Code asks "Do you trust this folder?" The user has no idea what's happening. This feature makes the worktree experience seamless: `aigon init` sets everything up, every agent launch verifies trust, and the docs explain what's happening before the user encounters it.

## The Problem (what happened today)

An agent launched in brewboard hit the Claude Code trust prompt because:
1. The worktree path wasn't pre-trusted
2. The `cd` into the worktree may have failed, landing in `$HOME`
3. No self-healing — once trust is lost, every launch fails until manually fixed
4. The getting started docs never mention worktrees or the sibling directory

## User Stories

- [ ] As a new user running `aigon init`, I want to be told that a worktrees directory will be created next to my project and have it set up automatically
- [ ] As a user, I want agents to never show trust prompts — trust should be automatic and self-healing
- [ ] As a user reading the install docs, I want to understand the worktree folder before I encounter it

## Acceptance Criteria

### aigon init handles worktree setup
- [ ] `aigon init` creates the `../{reponame}-worktrees/` directory
- [ ] `aigon init` tells the user: "Worktrees will be created in ../{reponame}-worktrees/ for parallel agent development"
- [ ] `aigon init` pre-trusts the worktrees directory for all installed agents (Claude, Gemini, Codex)
- [ ] If the worktrees directory already exists, init skips creation but still verifies trust

### Self-healing trust on every launch
- [ ] `buildAgentCommand()` shell wrapper verifies the cwd is correct before launching the agent CLI
- [ ] If the agent has a `trust` config (from 201's agent registry), the launch wrapper calls `ensureAgentTrust()` for the worktree path
- [ ] If trust fails, the launch logs a clear error message instead of showing an interactive prompt
- [ ] Trust verification happens in the shell trap wrapper, not in Node.js — so it works even if the server process has a stale cwd

### Documentation
- [ ] Getting started docs explain: "Aigon creates a `{project}-worktrees/` folder next to your project for parallel agent development. This is where feature branches are checked out when you use worktree mode."
- [ ] Installation docs mention worktrees as a prerequisite concept
- [ ] `aigon doctor` checks that the worktrees directory exists and is trusted

### Cleanup
- [ ] `aigon doctor --fix` prunes worktrees for completed features
- [ ] `feature-close` removes the worktree (already does this, verify it's reliable)

## Validation

```bash
node -c aigon-cli.js

# Init creates the worktrees directory
cd /tmp && mkdir test-repo && cd test-repo && git init && aigon init
ls ../test-repo-worktrees/ && echo "PASS: worktrees dir created" || echo "FAIL"
rm -rf /tmp/test-repo /tmp/test-repo-worktrees

# Trust is set after init
node -e "
const registry = require('./lib/agent-registry');
// Verify ensureAgentTrust function exists and is callable
console.log(typeof registry.ensureAgentTrust === 'function' ? 'PASS' : 'FAIL');
"
```

## Technical Approach

### 1. Extend `aigon init`

After creating `docs/specs/` structure, also:
- `mkdir -p ../{reponame}-worktrees`
- Call `ensureAgentTrust(agentId, [worktreeBasePath])` for each installed agent
- Print: "📂 Worktree directory: ../{reponame}-worktrees/"

### 2. Self-healing in shell wrapper

In `buildAgentCommand()`, add a trust verification step before the agent CLI launch:

```bash
# Verify we're in the right directory
if [ ! -d ".git" ] && [ ! -f ".git" ]; then
  echo "ERROR: Not in a git repository. Expected to be in worktree."
  exit 1
fi
# Re-trust on every launch (idempotent, fast)
aigon trust-worktree "$(pwd)" 2>/dev/null || true
```

### 3. New command: `aigon trust-worktree <path>`

Small command that calls `ensureAgentTrust()` for all installed agents. Called by the shell wrapper. Idempotent — safe to call on every launch.

### 4. Doctor integration

`aigon doctor` adds a check:
- Worktrees directory exists
- Worktrees directory is trusted for all installed agents
- No stale worktrees for completed features

### Key files:
- `lib/commands/setup.js` — extend init
- `lib/worktree.js` — add trust verification to shell wrapper
- `lib/commands/misc.js` — add trust-worktree command
- `docs/getting-started.md` or equivalent — document worktrees
- `lib/commands/setup.js` — extend doctor

## Dependencies

- depends_on: pluggable-agent-architecture (201, done — provides ensureAgentTrust)

## Out of Scope

- Moving worktrees inside the project (keep sibling convention)
- Making worktree location user-configurable (can add later)
- Worktree-level `.env` management (separate concern)

## Open Questions

- Should `aigon init` create the worktrees directory even if the user might never use worktree mode? (Recommend: yes — it's one empty directory, and discovering it later is worse than knowing about it upfront)
- Should the self-healing trust run on every launch or only when the agent detects a trust problem? (Recommend: every launch — it's idempotent and fast, and prevents the problem entirely)

## Related

- Feature 201: Pluggable Agent Architecture (provides the trust mechanism)
- Research 28: Gemini CLI Worktree Sandbox (related but different — Gemini's sandbox is a CLI limitation, not a trust issue)
- The trust prompt bug on brewboard f07 that triggered this feature
