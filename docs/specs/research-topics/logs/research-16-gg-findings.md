# Research Findings: Security Scanning for Development Workflow

## Findings

**Secret Detection Tools:**
- **Gitleaks:** Fastest, written in Go. Ideal for CI/CD and pre-commit hooks. High precision but static only (no live verification).
- **TruffleHog:** Excellent for deep audits and live verification of keys (checks if a detected key is active). Slower than Gitleaks.
- **detect-secrets:** Python-based, uses a "baseline" file to ignore old secrets and only alert on new ones. Great for noisy legacy repos but requires more setup.
- **git-secrets:** Older tool focused on AWS keys, mostly superseded by Gitleaks and TruffleHog.

**SAST/Security Scanning Tools:**
- **Semgrep:** Fast, open-source CLI that uses pattern matching (AST). Extremely quick, easy to write custom rules in YAML. Perfect for pre-commit hooks and CI.
- **Snyk Code:** Powerful AI-driven SAST with a low false-positive rate. Provides clear remediation. Best for developers wanting actionable fixes, but proprietary engine.
- **CodeQL:** Deep semantic analysis and taint tracking. Very slow and requires building a database. Not suitable for fast CLI scripts or pre-commit hooks, better for async CI/CD.

**Pre-commit & Pre-push Hooks:**
- **Pre-commit for Secrets:** Gitleaks is the industry standard for pre-commit secret scanning due to its speed and simplicity (single binary, fast execution).
- **Pre-push/CI for Broader Issues:** Semgrep excels here. It is fast enough to run as a pre-push hook or in CI to catch OWASP Top 10 vulnerabilities in JS/Node code without slowing down developers significantly.

**Agent-Driven Workflow Compatibility:**
- Tools like Gitleaks and Semgrep are fast CLI tools that can easily be run against a local worktree before an autonomous agent commits.
- Latency is minimal for Gitleaks (<1s). Semgrep is also very fast (seconds).
- Because agents work autonomously, the scanner should block commits or fail loudly so the agent can retry or abort, rather than prompting for user input.

**Aigon Lifecycle Hook Integration:**
- Scanners can be integrated into `feature-close` and `feature-submit`. Since these commands wrap git operations, running Gitleaks/Semgrep right before `git commit` or `git push` ensures no secrets or obvious vulnerabilities are merged to main.

**Pluggable Architecture Pattern:**
- Aigon can implement a scanner plugin interface (e.g., `scanners/gitleaks.js`) similar to coding agents. Users could configure it via `.aigon/config.json`:
  `"security": { "secretScanner": "gitleaks", "sastScanner": "semgrep" }`.

**Git Hook Level vs Aigon Command Level:**
- **Git Hook:** Catches manual commits by humans.
- **Aigon Command:** Catches agent operations centrally.
- **Trade-off:** Both are ideal. Aigon commands can enforce scanning for agent workflows natively, but generating actual `.git/hooks` ensures manual `git commit` is also protected.

**GitHub-side Solutions:**
- **GitHub Advanced Security (Secret Scanning & Code Scanning):** Provides repository-level protection. "Push Protection" blocks secrets from being pushed. However, this is server-side. Local scanning (Gitleaks) is still needed to prevent secrets from even entering local git history, especially in agent worktrees.

**Minimum Viable Setup:**
- The simplest setup to catch the `.env.local` incident is integrating **Gitleaks** directly into aigon's `feature-close` command. It's a single binary, runs instantly, and natively detects `.env` secrets.

## Sources
- Gitleaks vs TruffleHog vs detect-secrets: AppSecSanta, DevOpsSchool comparisons.
- Semgrep vs Snyk vs CodeQL: Semgrep Blog, Aikido Dev, Cycode.
- GitHub Advanced Security: GitHub Documentation (Secret Scanning & CodeQL).

## Recommendation
Integrate **Gitleaks** as the default secret scanner and run it synchronously during the `feature-close` and `feature-submit` aigon commands. For SAST, offer **Semgrep** as a recommended, opt-in CI/pre-push scanner. Implement a pluggable architecture in aigon so users can swap these out, but ship with Gitleaks by default since it requires zero configuration to catch things like `.env.local`.

## Suggested Features

| Feature Name | Description | Priority | Depends On |
| :--- | :--- | :--- | :--- |
| `security-gitleaks-integration` | Add Gitleaks scanning to `feature-close` and `feature-submit` to block secret commits. | high | none |
| `security-scanner-plugin-api` | Create a pluggable architecture for users to define custom security scanners in config. | medium | `security-gitleaks-integration` |
| `security-semgrep-sast` | Integrate Semgrep as an optional SAST step during `feature-submit`. | low | `security-scanner-plugin-api` |
| `security-git-hooks-init` | Add a command to automatically configure standard git pre-commit hooks for manual commits. | medium | none |