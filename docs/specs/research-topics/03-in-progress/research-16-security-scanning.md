# Research: Security Scanning for Development Workflow

## Context

A `.env.local` file containing secrets was recently committed and pushed to GitHub in the aigon repository. While this was caught and removed, it exposed a gap: there is no automated scanning for secrets or security vulnerabilities at any point in the aigon development workflow.

This matters for two reasons:
1. **Aigon itself** — the aigon repo and all repos where aigon is used need protection against accidental secret commits, vulnerable dependencies, and insecure code patterns.
2. **Aigon's users** — aigon orchestrates multiple AI agents (Claude Code, Codex, Gemini, Cursor) that generate and commit code autonomously. These agents can inadvertently introduce secrets or vulnerabilities without a human reviewing every line. Security scanning should be a first-class integration point in aigon, similar to how coding agents are pluggable today.

## Questions to Answer

- [ ] What are the leading secret-detection tools (e.g., gitleaks, truffleHog, detect-secrets, git-secrets)? How do they compare on speed, accuracy, false-positive rate, and maintenance?
- [ ] What are the leading SAST/security scanning tools for JavaScript/Node.js codebases (e.g., Semgrep, Snyk Code, CodeQL)? Which ones work well as CLI tools that can be called from scripts?
- [ ] Which tools can run as **pre-commit hooks** to catch secrets before they ever enter git history?
- [ ] Which tools can run as **pre-push hooks** or CI checks to catch broader security issues before code reaches GitHub?
- [ ] How well do these tools work in an **agent-driven workflow** where code is committed from worktrees by autonomous agents? Are there latency or compatibility concerns?
- [ ] Can a security scanner be integrated into aigon lifecycle hooks — specifically `feature-close`, `feature-submit`, `research-close`, and any other command that merges into main? What would the integration surface look like?
- [ ] Is there a **pluggable architecture** pattern where aigon users can select their preferred security scanner (similar to how they select coding agents)? What config shape would that take?
- [ ] Should scanning happen at the **git hook level** (pre-commit/pre-push), at the **aigon command level** (feature-close), or both? What are the trade-offs?
- [ ] Are there GitHub-side solutions (GitHub Advanced Security, secret scanning, Dependabot) that complement local scanning?
- [ ] What is the minimal viable setup — the simplest tool + integration that would have caught the `.env.local` incident?

## Scope

### In Scope
- Secret detection (API keys, tokens, passwords, env files)
- Static analysis for common security vulnerabilities (OWASP top 10 patterns)
- Integration points within aigon's existing hook/command architecture
- Plugin architecture design for user-configurable scanner selection
- Tools that work on macOS with Node.js codebases
- Compatibility with multi-agent worktree workflows

### Out of Scope
- Runtime security monitoring or WAF configuration
- Container/Docker image scanning
- Network security or infrastructure hardening
- Dependency vulnerability scanning (covered separately by npm audit / Dependabot)
- Building the actual aigon integration (that's a feature, not research)

## Inspiration

- The `.env.local` incident in aigon (commit `cfde844`)
- Aigon's existing plugin pattern for coding agents (`cc`, `gg`, `cx`, `cu`) as a model for scanner plugins
- The `feature-close` and `feature-submit` commands as natural integration points (they already run git operations)
- Claude Code hooks system as a potential integration layer
