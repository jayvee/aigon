# Research: Security Scanning for Development Workflow

## Context

A `.env.local` file containing secrets was recently committed and pushed to GitHub in the aigon repository. While this was caught and removed, it exposed a gap: there is no automated scanning for secrets or security vulnerabilities at any point in the aigon development workflow.

This matters for two reasons:
1. **Aigon itself** — the aigon repo and all repos where aigon is used need protection against accidental secret commits, vulnerable dependencies, and insecure code patterns.
2. **Aigon's users** — aigon orchestrates multiple AI agents (Claude Code, Codex, Gemini, Cursor) that generate and commit code autonomously. These agents can inadvertently introduce secrets or vulnerabilities without a human reviewing every line. Security scanning should be a first-class integration point in aigon, similar to how coding agents are pluggable today.

## Questions to Answer

- [x] What are the leading secret-detection tools? → **Gitleaks** (default), TruffleHog (high-assurance), detect-secrets (baseline-driven)
- [x] What are the leading SAST tools for JS/Node? → **Semgrep** (default), CodeQL (CI only), Snyk Code (commercial option)
- [x] Pre-commit hooks? → Gitleaks via `core.hooksPath` (works across worktrees)
- [x] Pre-push/CI? → Semgrep + TruffleHog `--only-verified`
- [x] Agent-driven workflow compatibility? → All tools work, speed is critical — gitleaks (ms) and semgrep (seconds) are fast enough
- [x] Aigon lifecycle integration? → `feature-close` is the un-bypassable gate; also `feature-submit`, `research-close`
- [x] Pluggable architecture? → `security` block in `.aigon/config.json` with stages, scanner selection, enforce/warn/off modes
- [x] Git hooks vs aigon commands? → Both. Git hooks catch 90%, aigon gate is un-bypassable backstop
- [x] GitHub-side solutions? → Push protection (free for public), CodeQL, Dependabot — complement local scanning
- [x] Minimal viable setup? → `.githooks/pre-commit` blocking `.env*` files + gitleaks at `feature-close`

## Recommendation

**Three-layer defense-in-depth, each serving a different purpose:**

```
Layer 1: Pre-commit hook (gitleaks)     → Prevents secrets entering git history
    ↓ bypassed by --no-verify?
Layer 2: Aigon gate (feature-close)     → Un-bypassable scan before merge to main
    ↓ pushed to GitHub?
Layer 3: GitHub (secret scanning + CI)  → Server-side backstop, deep analysis
```

**Tool selection (all three agents agree):**
- **Secrets**: Gitleaks — MIT, offline, milliseconds, 160+ patterns, worktree-compatible via `core.hooksPath`
- **SAST**: Semgrep — LGPL, offline, 5-30s, YAML custom rules, JSON output
- **CI complement**: CodeQL via GitHub code scanning (free for public repos)

**Key insight for agent-driven workflows:** The aigon gate at `feature-close` is more important than pre-commit hooks. Agents may bypass `--no-verify`, but they cannot bypass `aigon feature-close`. This is where the mandatory scan must live.

## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|---|---|---|---|
| security-scan-env-check | Block `.env`/`.env.local` from being committed via `.githooks/pre-commit` + `core.hooksPath` | high | `aigon feature-create security-scan-env-check` |
| security-scan-gate | Run secret scanning at `feature-close`/`feature-submit` as un-bypassable merge gate | high | `aigon feature-create security-scan-gate` |
| security-config | Add `security` block to `.aigon/config.json` — scanner selection, stages, enforce/warn/off | high | `aigon feature-create security-config` |
| security-scan-gitleaks | Integrate gitleaks as default secret scanner for pre-commit and merge gate | high | `aigon feature-create security-scan-gitleaks` |
| security-scan-sast-gate | Run Semgrep SAST at merge gate, block on high-severity findings | medium | `aigon feature-create security-scan-sast-gate` |
| security-scan-hooks-setup | Have `install-agent` configure `core.hooksPath` and install `.githooks/` | medium | `aigon feature-create security-scan-hooks-setup` |
| security-scan-pluggable | Pluggable scanner architecture — users configure which tools run at which checkpoints | medium | `aigon feature-create security-scan-pluggable` |
| security-scan-cc-hook | Use Claude Code PostCommit hook for scanning outside git's hook mechanism | medium | `aigon feature-create security-scan-cc-hook` |
| security-scan-eslint | Add `eslint-plugin-security` to recommended ESLint config during `aigon init` | low | `aigon feature-create security-scan-eslint` |
| security-github-docs | Document GitHub push protection, CodeQL, Dependabot as recommended complements | low | `aigon feature-create security-github-docs` |

### Feature Dependencies

- security-scan-gate → security-config (config defines which scanners run)
- security-scan-gitleaks → security-scan-gate (gitleaks is the default scanner for the gate)
- security-scan-sast-gate → security-scan-gate (SAST shares the gate infrastructure)
- security-scan-hooks-setup → security-scan-env-check (hooks setup builds on the env check)
- security-scan-pluggable → security-scan-gate (plugin API extends the gate runner)
- security-scan-cc-hook → security-scan-env-check (CC hook runs the same checks)

### Implementation Order

1. security-scan-env-check (zero dependencies, immediate value)
2. security-config (foundation for all scanner features)
3. security-scan-gate (un-bypassable merge gate)
4. security-scan-gitleaks (wire gitleaks into the gate)
5. security-scan-hooks-setup (worktree-compatible pre-commit hooks)
6. security-scan-sast-gate (Semgrep at merge time)
7. security-scan-pluggable (user-configurable scanners)
8. security-scan-cc-hook, security-scan-eslint, security-github-docs (lower priority)

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
