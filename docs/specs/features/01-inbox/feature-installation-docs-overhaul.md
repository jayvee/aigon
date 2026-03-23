# Feature: installation docs overhaul

## Summary
Rewrite all installation and onboarding documentation so a brand new user on macOS or Linux can go from zero to running their first feature without hitting any undocumented prerequisites, wrong package names, or dead ends. Currently the README, getting-started guide, and linux-install docs have contradictions, missing prerequisites, incorrect CLI package names, and no suggested clone location or seed repo for testing.

## User Stories
- [ ] As a new user on a fresh Mac, I can follow a single getting-started page and have aigon working end-to-end within 10 minutes
- [ ] As a new user on Linux (Ubuntu/Fedora/Arch), I can follow the same guide with platform-specific tabs and have aigon working
- [ ] As a new user, I can clone a seed repo and run a complete feature loop to verify my installation works
- [ ] As a new user, I can run `aigon doctor` and it tells me exactly what's missing or misconfigured

## Acceptance Criteria

### Documentation fixes
- [ ] **Prerequisites section** added to `site/content/getting-started.mdx` listing: Node.js 18+, Git 2.20+, tmux (with clear explanation: "required for Fleet/worktree mode, optional for single-agent Drive mode")
- [ ] **Platform tabs** in getting-started: macOS (Homebrew) and Linux (apt/dnf/pacman) install commands side by side
- [ ] **Clone location guidance**: `git clone https://github.com/jayvee/aigon.git ~/src/aigon` (or "your preferred location for code repos")
- [ ] **Fix Gemini CLI package name**: `@anthropic-ai/gemini-cli` → correct package name (verify on npm)
- [ ] **Fix Codex CLI package name**: `@openai/codex` → correct package name (verify on npm)
- [ ] **Claude Code install**: verify `brew install claude` is correct or update
- [ ] **Seed repo section**: add "Verify your installation" section that walks through cloning brewboard-seed and running a feature loop end-to-end
- [ ] **README.md**: add one-line prerequisites note pointing to getting-started guide
- [ ] **tmux consistency**: resolve "optional" vs "required" contradiction across all docs — pick one framing and use it everywhere
- [ ] **`docs/linux-install.md`**: reconcile with getting-started.mdx so they don't contradict each other; consider merging linux-install content into the main guide as a platform tab

### CLI improvements
- [ ] **`aigon doctor`**: check Node.js version (warn if < 18), check git availability, check which agent CLIs are in PATH
- [ ] **`aigon install-agent`**: before writing config files, verify the agent CLI binary is in PATH; print install instructions if missing
- [ ] **`package.json`**: add `"engines": { "node": ">=18.0.0" }` field

### Seed repo for testing
- [ ] Getting-started guide includes a "Try it end-to-end" section:
  ```
  git clone https://github.com/jayvee/brewboard-seed.git ~/src/brewboard
  cd ~/src/brewboard
  aigon init
  aigon install-agent cc
  aigon feature-now "add dark mode"
  ```
- [ ] Explain what to expect at each step (what output to look for, what success looks like)

## Validation
```bash
node -c aigon-cli.js
node -c lib/commands/setup.js
```

## Technical Approach

### Document hierarchy
1. **README.md** — 5 lines max for install, links to getting-started
2. **site/content/getting-started.mdx** — single source of truth for installation, platform-specific, includes seed repo walkthrough
3. **docs/linux-install.md** — either merge into getting-started or keep as deep-dive with clear cross-reference

### Agent CLI verification
In `lib/commands/setup.js`, before `install-agent` writes files:
```js
const agentBin = { cc: 'claude', gg: 'gemini', cx: 'codex', cu: 'cursor' };
try { execSync(`which ${agentBin[agentId]}`, { stdio: 'pipe' }); }
catch { console.warn(`⚠️  ${agentBin[agentId]} not found in PATH. Install it first: ...`); }
```

### Doctor enhancements
Add to the existing doctor command in `lib/commands/setup.js`:
- `node -v` check → warn if < 18
- `git --version` check
- For each known agent CLI, check `which <binary>` and report found/missing

## Dependencies
- Verify correct npm package names for Gemini CLI, Codex CLI, Claude Code before writing docs
- brewboard-seed repo must be public on GitHub

## Out of Scope
- Windows/WSL support documentation (separate feature)
- Video tutorials or interactive guides
- Automated installation scripts (e.g., `curl | bash`)

## Open Questions
- Should `docs/linux-install.md` be merged into the getting-started guide or kept separate?
- What is the correct npm package for Codex CLI? Is it installable via npm at all?
- Should `aigon install-agent` hard-fail or soft-warn when the CLI binary is missing?

## Related
- Feature 141: linux terminal support (just shipped — adds Linux platform detection)
- `docs/linux-install.md` (created by feature 141)
- `site/content/getting-started.mdx` (primary doc to overhaul)
