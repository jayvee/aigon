# Research Findings: security scanning

**Agent:** Claude (cc)
**Research ID:** 16
**Date:** 2026-03-20

---

## Key Findings

### 1. AI Agent Code Security Is a Growing Crisis

GitGuardian's 2026 report found **28.65 million new hardcoded secrets** pushed to public GitHub repos in 2025, a 34% YoY increase. Critically, **commits generated with AI coding tools leak secrets at roughly 2x the baseline rate** -- Claude Code-assisted commits showed a 3.2% secret-leak rate vs 1.5% baseline. AI-service-related secrets jumped 81% YoY to 1.27 million.

New attack vectors are emerging around AI infrastructure itself. CVE-2026-21852 affected Claude Code versions prior to 2.0.65, allowing API credential theft via malicious project configurations. Poisoned rule files (`.cursorrules`, `CLAUDE.md`) can persist across forks, creating supply chain attack vectors.

The core risk for aigon: agents commit autonomously from worktrees without human review of every line. Any agent can generate code that hardcodes an API key, database credential, or token.

### 2. Pre-commit Framework and Git Worktrees

**How pre-commit works:** You define a `.pre-commit-config.yaml` in the repo root, run `pre-commit install`, and hooks run on every `git commit`. Hooks only scan staged/changed files, so they're fast.

**Worktree compatibility -- known issues:**
- **Issue #808** (pre-commit/pre-commit): `pre-commit install` installs hooks in the wrong directory for worktrees. It writes to `$GIT_DIR/hooks/` (the worktree-specific directory) instead of the main repo's hooks directory. This means hooks installed in the main worktree may not automatically apply to linked worktrees.
- **Issue #1972**: Similar wrong-path issues reported for worktrees.
- The workaround is to run `pre-commit install` inside each worktree, or use `core.hooksPath` pointing to an absolute path.

**Programmatic commits:** Pre-commit hooks fire for any `git commit`, whether interactive or programmatic. They can be bypassed with `--no-verify`.

### 3. Git Hook Behavior in Worktrees

Git's hook resolution for worktrees follows these rules:

- **Default behavior:** The hooks directory is `$GIT_DIR/hooks`. For worktrees, `$GIT_DIR` points to `.git/worktrees/<name>/`, NOT the main `.git/` directory.
- **With `$GIT_COMMON_DIR`:** When `$GIT_COMMON_DIR` is set (as it is for worktrees), `$GIT_COMMON_DIR/hooks` is used instead of `$GIT_DIR/hooks`. This means hooks in the main repo's `.git/hooks/` *should* be shared.
- **`core.hooksPath`:** Overrides both of the above. It's a repo-wide config setting (shared across worktrees by default since config is shared). Can be set per-worktree with `git config --worktree core.hooksPath <path>`. **Must use absolute paths** for worktrees to resolve correctly.
- **Practical recommendation:** Set `core.hooksPath` to an absolute path in the repo (e.g., the repo root's `.githooks/` directory) to guarantee all worktrees use the same hooks.

### 4. Pre-commit vs CI vs Gate Command Scanning

| Approach | Catches before history? | Bypassable? | Speed impact | Agent-friendly? |
|----------|------------------------|-------------|-------------|-----------------|
| **Pre-commit hook** | Yes | Yes (`--no-verify`) | Must be <1s or devs skip | Medium -- agents can bypass |
| **Pre-push hook** | No (in local history) | Yes (`--no-verify`) | Can be slower | Medium |
| **CI pipeline** | No (in remote history) | No (if branch protection) | No local impact | Yes |
| **Gate command** (e.g., `feature-close`) | No (in local history) | Only if command is skipped | Controlled | Yes -- natural checkpoint |
| **Server-side pre-receive** | Yes (rejects push) | No | No local impact | Yes |

**Key insight for aigon:** Pre-commit hooks are the only approach that prevents secrets from entering git history at all. But they can be bypassed with `--no-verify`, and AI agents (especially Claude Code) may use `--no-verify` in their settings. The defense-in-depth approach is: pre-commit (fast, catches most), plus a gate at `feature-close`/`feature-submit` (cannot be bypassed within aigon workflow), plus CI as final backstop.

**For agent workflows specifically:** A gate command is the best checkpoint because:
1. It cannot be bypassed by `--no-verify`
2. It runs at a natural workflow boundary (before merge to main)
3. It can scan all commits in the feature branch, not just individual commits
4. It doesn't slow down the agent's iterative commit cycle

### 5. Minimal Viable Setup to Catch .env Files

**Layer 1 -- .gitignore (already done):**
```
.env
.env.local
.env*.local
```
This prevents untracked .env files from being added. But it does NOT help if the file was already tracked, or if someone uses `git add -f`.

**Layer 2 -- pre-commit hook with forbidden-files check:**
Using the pre-commit framework:
```yaml
repos:
  - repo: https://github.com/pre-commit/pre-commit-hooks
    rev: v4.6.0
    hooks:
      - id: check-added-large-files
      - id: detect-private-key
  - repo: https://github.com/Yelp/detect-secrets
    rev: v1.5.0
    hooks:
      - id: detect-secrets
        args: ['--baseline', '.secrets.baseline']
```

Or even simpler, a plain shell hook (no framework dependency):
```bash
#!/bin/bash
# .githooks/pre-commit
if git diff --cached --name-only | grep -qE '\.env(\.local)?$'; then
  echo "ERROR: Attempting to commit .env file"
  exit 1
fi
```

**Layer 3 -- aigon gate command:**
Add a scan step to `feature-close` and `feature-submit` that checks the diff between the feature branch and main for any .env files or detected secrets.

**Absolute simplest approach that would have caught the .env.local incident:** A 4-line shell script in `.githooks/pre-commit` plus `core.hooksPath=.githooks` in the repo config. No external dependencies. No framework.

### 6. The --no-verify Problem

Any client-side git hook can be bypassed with `git commit --no-verify`. This is by design in git and cannot be prevented locally. Mitigation options:

1. **Server-side pre-receive hooks** -- not available on GitHub (only GitHub Enterprise)
2. **CI pipeline + branch protection** -- scan on push, block merge if scan fails
3. **Aigon gate command** -- scan at `feature-close`/`feature-submit` before merge
4. **Claude Code hooks** -- aigon already uses SessionStart hooks; a PostCommit hook could run scanning without relying on git's hook mechanism
5. **Audit trail** -- detect when `--no-verify` was used and flag it

For aigon specifically: the Claude Code hooks system (configured in `.claude/settings.json`) runs outside git's hook mechanism and cannot be bypassed by `--no-verify`. This is a natural integration point.

## Sources

- [GitGuardian 2026 Report: AI Coding Tools Double Secret Leak Rates](https://hackernoob.tips/ai-coding-tools-double-secret-leak-rates-2026/)
- [Claude Code Security: Why the Real Risk Lies Beyond Code (GitGuardian)](https://blog.gitguardian.com/claude-code-security-why-the-real-risk-lies-beyond-code/)
- [New Vulnerability in GitHub Copilot and Cursor (Pillar Security)](https://www.pillar.security/blog/new-vulnerability-in-github-copilot-and-cursor-how-hackers-can-weaponize-code-agents)
- [Security Horizon of Agentic AI: Claude Code Case Study](https://securityboulevard.com/2026/03/the-security-horizon-of-agentic-ai-a-claude-code-case-study/)
- [Flaws in Claude Code Put Developers' Machines at Risk (Dark Reading)](https://www.darkreading.com/application-security/flaws-claude-code-developer-machines-risk)
- [Pre-commit Framework](https://pre-commit.com/)
- [Pre-commit Issue #808: Hooks not installed in right directory for worktrees](https://github.com/pre-commit/pre-commit/issues/808)
- [Pre-commit Issue #1972: Wrong path in case of workdirs](https://github.com/pre-commit/pre-commit/issues/1972)
- [Git Worktree Documentation](https://git-scm.com/docs/git-worktree)
- [Git Hooks Documentation](https://git-scm.com/docs/githooks)
- [Using Git Hooks When Creating Worktrees (Mark Skelton)](https://mskelton.dev/bytes/using-git-hooks-when-creating-worktrees)
- [Pre-commit vs CI (Switowski)](https://switowski.com/blog/pre-commit-vs-ci/)
- [Do Pre-Commit Hooks Prevent Secrets Leakage? (Truffle Security)](https://trufflesecurity.com/blog/do-pre-commit-hooks-prevent-secrets-leakage)
- [Git Hooks Glossary (GitGuardian)](https://www.gitguardian.com/glossary/git-hooks)
- [Yelp/detect-secrets](https://github.com/Yelp/detect-secrets)
- [detect-secrets pre-commit config](https://github.com/Yelp/detect-secrets/blob/master/.pre-commit-hooks.yaml)
- [When AI Meets CI/CD: Coding Agents in GitHub Actions (StepSecurity)](https://www.stepsecurity.io/blog/when-ai-meets-ci-cd-coding-agents-in-github-actions-pose-hidden-security-risks)
- [Secret Scanning Tools Across the SDLC (Soteri)](https://soteri.io/blog/secret-scanning-tools-for-the-sdlc)
- [Gitleaks Releases](https://github.com/gitleaks/gitleaks/releases)
- [TruffleHog Releases](https://github.com/trufflesecurity/trufflehog/releases)
- [detect-secrets Releases](https://github.com/Yelp/detect-secrets/releases)
- [git-secrets Tags -- last release Feb 2019](https://github.com/awslabs/git-secrets/tags)
- [ggshield GitHub](https://github.com/GitGuardian/ggshield)
- [TruffleHog vs Gitleaks Comparison (Jit)](https://www.jit.io/resources/appsec-tools/trufflehog-vs-gitleaks-a-detailed-comparison-of-secret-scanning-tools)
- [Gitleaks vs TruffleHog 2026 (AppSec Santa)](https://appsecsanta.com/sast-tools/gitleaks-vs-trufflehog)
- [Best Secret Scanning Tools 2025 (Aikido)](https://www.aikido.dev/blog/top-secret-scanning-tools)
- [Secret Scanning Tools 2026 (GitGuardian)](https://blog.gitguardian.com/secret-scanning-tools/)
- [GitHub Push Protection Docs](https://docs.github.com/en/code-security/secret-scanning/introduction/about-push-protection)
- [GitHub Secret Protection Product (April 2025)](https://github.blog/changelog/2025-03-04-introducing-github-secret-protection-and-github-code-security/)
- [Betterleaks -- Gitleaks Successor (Aikido)](https://www.aikido.dev/blog/betterleaks-gitleaks-successor)
- [TruffleHog Pre-commit Docs](https://docs.trufflesecurity.com/pre-commit-hooks)
- [detect-secrets in Microsoft Engineering Playbook](https://microsoft.github.io/code-with-engineering-playbook/CI-CD/dev-sec-ops/secrets-management/recipes/detect-secrets/)
- [Secret Scanner Comparison (Medium)](https://medium.com/@navinwork21/secret-scanner-comparison-finding-your-best-tool-ed899541b9b6)

## Recommendation

**Recommended approach for aigon: three layers, progressively complex.**

**Immediate (zero-dependency):**
1. Add a `.githooks/pre-commit` shell script that blocks `.env*` files from being committed
2. Set `core.hooksPath=.githooks` in the repo -- this works across all worktrees
3. Have `aigon install-agent` configure this automatically for managed repos

**Short-term (aigon integration):**
4. Add a scan step to `feature-close` and `feature-submit` that runs before merge -- this is the un-bypassable gate
5. Use Claude Code's hook system (PostCommit or PreCommit in `.claude/settings.json`) as an additional integration point that runs outside git's hook mechanism
6. Start with a simple file-pattern check, expand to `detect-secrets` or `gitleaks` later

**Medium-term (pluggable architecture):**
7. Define a scanner plugin interface in aigon config (similar to agent selection): `{ "scanners": ["env-check", "detect-secrets"] }`
8. Let users configure which scanners run at which checkpoints (pre-commit, feature-close, CI)
9. Ship built-in "env-check" scanner, let users add custom ones

The key insight is that for agent-driven workflows, **the gate command is more important than the pre-commit hook**. Agents may bypass `--no-verify`, but they cannot bypass `aigon feature-close`. This is where the mandatory scan should live.

## Tool Comparison: Secret Detection Scanners

### Comparison Matrix

| Attribute | **gitleaks** | **TruffleHog** | **detect-secrets** (Yelp) | **git-secrets** (AWS) | **ggshield** (GitGuardian) |
|---|---|---|---|---|---|
| **Current version** | v8.30.0 | v3.93.8 | v1.5.0 | v1.3.0 | v1.48.0 |
| **Last release** | Nov 26, 2025 | Mar 9, 2026 | May 6, 2024 | Feb 10, 2019 | Feb 18, 2026 |
| **GitHub stars** | 25.5k | 25.1k | 4.4k | 13.2k | 1.9k |
| **Language** | Go | Go | Python | Bash | Python |
| **License** | MIT | AGPL-3.0 | Apache-2.0 | Apache-2.0 | MIT |
| **Maintenance** | Active (monthly) | Very active (weekly) | Slow (~annual) | Abandoned (last release 2019) | Active (monthly) |
| **Secret types** | ~160+ (regex) | 800+ (with verification) | ~30+ (plugin-based) | AWS-focused only | 500+ (cloud API) |
| **Install (macOS)** | `brew install gitleaks` | `brew install trufflehog` | `pip install detect-secrets` | `brew install git-secrets` | `brew install gitguardian/tap/ggshield` |
| **Also installable via** | Go, Docker, binary | Go, Docker, binary | pip only | make install | pipx, pip, .pkg |
| **Config format** | `.gitleaks.toml` (TOML) | CLI flags + path files | `.secrets.baseline` (JSON) | git config entries | `.gitguardian.yaml` |
| **Custom rules** | Yes (regex in TOML) | Enterprise only | Yes (Python plugins) | Yes (regex patterns) | Enterprise only |
| **Allowlists** | Global + per-rule | `--exclude-paths` file | Baseline whitelist | `--allowed` patterns | `.gitguardian.yaml` |
| **Pre-commit hook** | Yes (native + framework) | Yes (framework) | Yes (framework) | Yes (native) | Yes (native + framework) |
| **Pre-push hook** | Yes (framework stages) | Yes (framework stages) | No (custom only) | No | Yes |
| **CI/CD integrations** | GitHub Action, GitLab native | GitHub Action, GitLab, any CI | Any CI (no official Action) | Manual only | GitHub, GitLab, Bitbucket, CircleCI, Jenkins, Azure DevOps |
| **Scan specific files/dirs** | Yes | Yes (`filesystem` subcommand) | Yes | Yes (`--scan -r`) | Yes (`scan path`) |
| **Network required** | No | Yes (for verification) | No | No | Yes (cloud API) |
| **macOS support** | Full | Full | Full (Python) | Full | Full |
| **Key differentiator** | Speed + low false positives | Live credential verification | Baseline approach | AWS credential patterns | ML-backed cloud detection |

### Speed Comparison

| Tool | Pre-commit scan time | Full repo scan | Notes |
|---|---|---|---|
| **gitleaks** | Milliseconds | ~11 seconds | No network calls; compiled regex only |
| **TruffleHog** | Seconds | 30-60+ seconds | Verification adds network latency; `--only-verified` is slower but higher quality |
| **detect-secrets** | Fast (current state) | Minutes (first baseline) | Scans current state only, not git history |
| **git-secrets** | Milliseconds | Seconds | Simple grep; very narrow pattern set |
| **ggshield** | 1-3 seconds | Variable | Depends on network/API latency |

### False Positive Profile

| Tool | False positive rate | Mitigation approach |
|---|---|---|
| **gitleaks** | Low | Allowlists (global + per-rule), composite rules since v8.28.0 requiring multiple pattern matches in proximity. Known issues with auto-generated files triggering "generic-api-key" rule. |
| **TruffleHog** | Very low (effective) | Live verification eliminates most FPs -- `--only-verified` shows only confirmed-active secrets. When it finds an AWS key, it tests whether that key still works. |
| **detect-secrets** | Medium-high | Baseline file lets you whitelist known FPs. Keyword plugin is the noisiest. Plugin-based architecture lets you disable noisy detectors. |
| **git-secrets** | Very low | Narrow pattern set = fewer triggers, but also much lower coverage. |
| **ggshield** | Very low | Cloud ML analysis. Filters secrets < 6 chars. But requires sending code to GitGuardian servers. |

### Installation Detail

**gitleaks:**
- `brew install gitleaks`
- `go install github.com/gitleaks/gitleaks/v8@latest`
- Docker: `ghcr.io/gitleaks/gitleaks`
- Pre-built binaries on GitHub releases (Linux, macOS, Windows)

**TruffleHog:**
- `brew install trufflehog`
- `go install github.com/trufflesecurity/trufflehog/v3@latest`
- Docker: `trufflesecurity/trufflehog`
- Pre-built binaries on GitHub releases

**detect-secrets:**
- `pip install detect-secrets` (Python 3.8+ required)
- No Homebrew formula, no binary releases
- npm wrapper exists (`detect-secrets` on npm) but is 6 years stale

**git-secrets:**
- `brew install git-secrets`
- `make install` from cloned repo
- Pure bash script, no compilation

**ggshield:**
- `brew install gitguardian/tap/ggshield`
- `pipx install ggshield` (recommended)
- macOS .pkg installer, Linux deb/rpm packages
- Requires GitGuardian API key (free tier: 25 incidents/month)

### License Implications

| Tool | License | Concern for aigon |
|---|---|---|
| gitleaks | MIT | None -- fully permissive |
| TruffleHog | AGPL-3.0 | If aigon modified and distributed TruffleHog, must release modifications. Fine for internal/CI use. Not ideal if aigon ships a modified version. |
| detect-secrets | Apache-2.0 | None -- permissive |
| git-secrets | Apache-2.0 | None -- permissive |
| ggshield | MIT | None license-wise, but cloud API dependency is the real concern |

### Newer/Emerging Tools

**GitHub Native Secret Scanning** (not a CLI tool):
- Push protection is free for all public repos, enabled by default since 2024.
- As of March 2026: 28 new detectors from 15 providers; 39 with push protection on by default.
- Since April 2025, available as standalone "GitHub Secret Protection" product for Team plans.
- Limitation: partner token formats only on free tier; no custom patterns; no local scanning.

**Betterleaks** (Aikido):
- Marketed as a "gitleaks successor" by Aikido.dev, focused on faster scanning.
- Very new; limited adoption data available.

### Tool Recommendation for aigon

**Primary: gitleaks** -- Best fit for pre-commit hooks in agent-driven worktree workflows.
- Fastest tool (milliseconds for pre-commit, critical for not slowing agents)
- Fully offline (no API keys, no cloud dependency, no privacy concerns)
- MIT license (no distribution restrictions)
- `.gitleaks.toml` config is simple, versionable, and customizable
- Excellent macOS support, Homebrew install
- GitLab uses it as their built-in secret detection engine (industry validation)
- Active community (25.5k stars, monthly releases)

**Complementary: TruffleHog in CI** -- Run with `--only-verified` for deeper post-push analysis.
- Catches what regex-only scanning misses via live credential verification
- AGPL license is fine for CI pipeline usage

**Not recommended for aigon:**
- **git-secrets**: Abandoned since 2019, AWS-only patterns, no reason to adopt
- **detect-secrets**: Slow release cadence, higher false positives, Python-only dependency
- **ggshield**: Cloud API requirement incompatible with offline-first tool philosophy

### 7. SAST Tools for JavaScript/Node.js -- Detailed Analysis

#### Semgrep

| Attribute | Details |
|-----------|---------|
| **CLI standalone** | Yes. `brew install semgrep` (macOS), `pip install semgrep`, or Docker. Runs fully offline with local rules via `semgrep scan --config path/to/rules.yml .` |
| **Speed** | Fast -- pattern-matching engine, not compilation-based. Typical Node.js project (5K-50K lines) scans in 5-30 seconds. No database build step (unlike CodeQL). |
| **Detection patterns** | XSS, SQL injection, command injection, eval with dynamic input, insecure regex, path traversal, SSRF, hardcoded secrets, insecure crypto, open redirects, prototype pollution. 250+ Pro rules for JS, community rules freely available. |
| **False positive rate** | Low-to-moderate. Pattern-based matching is precise. Pro rules (cross-file dataflow) significantly reduce false positives vs community rules. Users report it as one of the lowest FP rates among SAST tools. |
| **Custom rules** | Excellent. YAML-based rule syntax. Local `.semgrep.yml` files. Supports pattern matching, metavariables, taint tracking. Interactive playground at semgrep.dev/editor. |
| **Pricing** | CLI engine is open source (LGPL-2.1). Free tier: up to 50 repos, 10 contributors. Team: $30/mo per contributor. Community rules are free; Pro rules require account (free tier available). |
| **macOS** | Full support, including Apple Silicon via Homebrew. |
| **Node.js invocation** | Yes, `child_process.execSync('semgrep scan --json --config auto .', ...)`. Returns structured JSON to stdout. |
| **Output formats** | JSON, SARIF, text, JUnit XML, GitLab SAST, GitLab Secrets, Emacs, Vim. File output variants for each (`--json-output=file`). |
| **JS/TS support level** | GA (Generally Available). Cross-file dataflow analysis, framework-specific control flow, 250+ Pro rules. |

**Verdict:** Best overall choice for local SAST. Fast, precise, excellent custom rule support, native JSON/SARIF output, trivial to invoke from Node.js.

#### Snyk Code

| Attribute | Details |
|-----------|---------|
| **CLI standalone** | Yes. `npm install -g snyk` then `snyk code test`. Requires authentication (`snyk auth`) -- cloud-based analysis engine, code snippets are sent to Snyk servers. |
| **Speed** | Claims 50x faster than legacy SAST and 2.4x faster than "other modern SAST tools." In practice, 10-60 seconds depending on project size and network latency (cloud roundtrip). |
| **Detection patterns** | XSS, SQL injection, command injection, path traversal, hardcoded secrets, insecure deserialization, SSRF, open redirects, prototype pollution. Uses DeepCode AI engine with semantic analysis. |
| **False positive rate** | Low. AI/ML-based engine trained on real-world code. Snyk markets this as a key differentiator. |
| **Custom rules** | Limited on free/team tiers. Custom rules available on Enterprise plan only. |
| **Pricing** | Free: 100 tests/month. Team: $25/mo per developer (1000 tests/month). Enterprise: custom pricing, unlimited tests. |
| **macOS** | Full support via npm or standalone binary. |
| **Node.js invocation** | Yes, `child_process.execSync('snyk code test --json', ...)`. |
| **Output formats** | JSON, SARIF (via `--sarif`), text (default). |
| **Key limitation** | Requires network connectivity -- analysis happens server-side. Code snippets leave the machine. 100 tests/month free limit would be hit quickly in an agent-driven workflow. |

**Verdict:** Strong detection quality but cloud dependency and test limits make it impractical as the primary local scanner for agent workflows. Better as a complementary CI-level check.

#### CodeQL

| Attribute | Details |
|-----------|---------|
| **CLI standalone** | Yes. Download bundle from github.com/github/codeql-action/releases. Extract, add to PATH. Runs locally without GitHub Actions. |
| **Speed** | Slow. Requires building a database first (`codeql database create --language=javascript`), which can take 1-5 minutes for a medium project. Query execution adds another 1-5 minutes. Total: 2-10 minutes per scan. |
| **Detection patterns** | Comprehensive. XSS, SQL injection, command injection, path traversal, insecure randomness, prototype pollution, regex injection, SSRF, open redirects, unsafe deserialization. Deep semantic analysis with dataflow tracking. |
| **False positive rate** | Low. Semantic analysis with full program understanding. Considered one of the most accurate SAST engines. |
| **Custom rules** | Powerful but complex. Custom queries written in QL (a dedicated query language). Steep learning curve compared to Semgrep YAML. |
| **Pricing** | Free for open-source repos. For private repos, requires GitHub Advanced Security license ($49/mo per committer). The CLI itself is free to download and use. |
| **macOS** | Supported. Apple Silicon needs Rosetta 2 and Xcode CLI tools. |
| **Node.js invocation** | Possible but awkward. Two-step process: `codeql database create` then `codeql database analyze`. Multi-minute runtime makes it unsuitable for hooks. |
| **Output formats** | SARIF (primary), CSV. JSON through SARIF. Use `--format=sarif-latest`. |
| **Key limitation** | Too slow for pre-commit/pre-push hooks or interactive CLI usage. Best suited for CI pipelines or nightly scans. Database creation step is a dealbreaker for local developer workflow. |

**Verdict:** Most thorough analysis but far too slow for local/hook integration. Best used as a CI-level deep scan via GitHub code scanning.

#### ESLint Security Plugins

**eslint-plugin-security** (v4.0.0, Feb 2026, actively maintained):
14 rules covering: `eval()` with expressions, dynamic `require()`, dynamic filesystem paths, unsafe regex (ReDoS), buffer `noAssert`, child_process detection, CSRF middleware ordering, timing attacks, pseudo-random bytes, object injection via bracket notation, disabled mustache escaping, `new Buffer()`, bidi character attacks.

- Speed: Near-instant, runs as part of normal ESLint pass (~1-3s additional).
- False positives: Moderate-to-high. `detect-object-injection` is notoriously noisy (flags any `obj[variable]`). `detect-non-literal-fs-filename` flags many legitimate uses.
- Custom rules: Standard ESLint config. Cannot add security patterns without writing ESLint plugins.
- Fully open source. All ESLint output formats (text, JSON, SARIF via formatter).

**eslint-plugin-no-secrets**:
Entropy-based secret detection in string literals/comments + pattern matching for known formats (AWS keys, API tokens). Modeled after truffleHog but on ESLint AST. Two rules: `no-secrets` (entropy + patterns) and `no-pattern-match` (text grep). Configurable `tolerance` threshold (default 4).

**Verdict:** eslint-plugin-security is a lightweight first line of defense -- zero install cost if ESLint is already used. High false-positive rate on some rules needs tuning. Not a substitute for a real SAST tool, but complementary.

#### njsscan

| Attribute | Details |
|-----------|---------|
| **CLI standalone** | Yes. `pip install njsscan`. Command: `njsscan /path/to/project`. |
| **Speed** | Fast. Uses libsast (pattern matching) + Semgrep under the hood. |
| **Detection patterns** | SQL injection, XSS, open redirects, Node.js-specific insecure patterns. |
| **False positive rate** | Moderate. Pattern-based without deep dataflow. Less precise than standalone Semgrep with Pro rules. |
| **Pricing** | Fully open source (GPL-3.0). |
| **macOS** | Supported (macOS and Linux; Windows dropped from v4+). |
| **Output formats** | JSON, SARIF 2.1.0, SonarQube XML, HTML, text. |
| **Latest release** | v0.4.3 (November 2024). |
| **Key limitation** | Uses Semgrep internally, so running both is redundant. Semgrep alone covers a superset. |

**Verdict:** Largely redundant if using Semgrep directly.

### 8. GitHub-Side Security Solutions

#### GitHub Code Scanning (CodeQL)
- Runs CodeQL automatically on push/PR via GitHub Actions
- Free for public repositories; private repos require GitHub Advanced Security ($49/mo per active committer)
- Uploads SARIF results, displays alerts inline on PRs
- **Complements local scanning:** Deep semantic analysis too slow for local hooks. Catches complex dataflow vulnerabilities that pattern-based tools miss.

#### GitHub Dependabot
- Monitors dependency graph against GitHub Advisory Database
- Alerts on known vulnerable dependencies in `package.json` / `package-lock.json`
- Free for all repositories (public and private)
- Automatically opens PRs to bump vulnerable dependencies
- **Complements local scanning:** Handles supply-chain/dependency vulnerabilities -- different attack surface than SAST.

#### GitHub Secret Scanning + Push Protection
- Scans repository content for known secret patterns; partners with providers (AWS, Stripe) to auto-revoke exposed tokens
- Push protection blocks pushes containing detected secrets server-side
- Free for public repos; private repos need GitHub Team/Enterprise + Secret Protection
- Custom patterns via regex for organization-specific secrets
- **Complements local scanning:** Server-side backstop even if pre-commit hooks are bypassed. Scans entire git history.

#### Layered Defense Model

| Layer | Tool | What it catches | When |
|-------|------|-----------------|------|
| Pre-commit (local) | gitleaks, Semgrep | Secrets, basic SAST patterns | Before `git commit` |
| Gate command (aigon) | Semgrep | Full SAST scan, un-bypassable | At `feature-close` |
| Push protection (GitHub) | Secret scanning | Known secret patterns | During `git push` (server-side) |
| CI (GitHub Actions) | CodeQL, Snyk | Deep SAST, supply chain | After push, on PR |
| Continuous (GitHub) | Dependabot | Vulnerable dependencies | Ongoing monitoring |

### 9. SAST Tool Comparative Summary

| Tool | Speed | Detection Depth | False Positives | Custom Rules | Free | Offline | Best Use |
|------|-------|----------------|-----------------|--------------|------|---------|----------|
| **Semgrep** | Fast (5-30s) | Good (great w/ Pro) | Low-moderate | Excellent (YAML) | Yes (core) | Yes | Pre-commit, gate commands, CLI |
| **Snyk Code** | Medium (10-60s) | Very good | Low | Enterprise only | 100 tests/mo | No | CI pipeline |
| **CodeQL** | Slow (2-10min) | Excellent | Very low | Complex (QL lang) | OSS repos | Yes | CI deep scan |
| **ESLint security** | Instant | Basic | Moderate-high | ESLint standard | Yes | Yes | Lint pass (additive) |
| **njsscan** | Fast | Moderate | Moderate | YAML config | Yes | Yes | Redundant if using Semgrep |

### 10. SAST Recommendation for aigon

**Primary SAST tool: Semgrep**

1. **Speed** -- 5-30 second scans viable for `feature-close`/`feature-submit` gate without blocking flow.
2. **CLI-first** -- trivial to invoke via `child_process.execSync()` with JSON output parsing.
3. **Offline** -- no cloud dependency, no test quotas, no code leaving the machine. Critical for agent workflows.
4. **Custom rules in YAML** -- aigon could ship default security rules and allow user customization.
5. **JS/TS GA support** -- cross-file dataflow, 250+ rules, actively maintained.
6. **macOS native** -- `brew install semgrep`, Apple Silicon support.

**Complementary layers:**
- **gitleaks** for secret detection in pre-commit hooks (millisecond speed, different concern than SAST).
- **eslint-plugin-security** as zero-cost addition for ESLint projects.
- **GitHub secret scanning + push protection** as server-side backstop.
- **CodeQL via GitHub code scanning** for deep CI analysis on important repos.

**Integration strategy:**
- Pre-commit: gitleaks (secrets, milliseconds).
- feature-close/feature-submit gate: Semgrep full SAST (5-30s, un-bypassable).
- CI: CodeQL for deep analysis (free for public repos).
- Pluggable config: `{"scanners": {"secrets": "gitleaks", "sast": "semgrep"}}` in `.aigon/config.json`.

### 11. Aigon Codebase Integration Architecture

#### Existing Hook System

Aigon already has a user-extensible hook system (`lib/utils.js`, lines 29-156):
- Hooks defined in `docs/aigon-hooks.md` as `## pre-<command>` / `## post-<command>` sections with bash code blocks
- `runPreHook(commandName, context)` — runs before a command; returning `false` aborts the command
- `runPostHook(commandName, context)` — runs after; warns on failure but doesn't abort
- `executeHook()` runs scripts via `execSync` with env vars: `AIGON_PROJECT_ROOT`, `AIGON_COMMAND`, `AIGON_FEATURE_ID`, `AIGON_FEATURE_NAME`, `AIGON_MODE`, `AIGON_AGENTS`, `AIGON_AGENT`, `AIGON_WORKTREE_PATH`

#### Best Integration Points (ranked by value)

**1. `pre-feature-close` hook** (`lib/commands/feature.js`, line 1418)
- Highest value. Blocks merge to main. Already has abort semantics.
- Scanner runs on the complete feature branch diff before merge at line 1563 (`git merge --no-ff`).
- Hook context includes `featureId`, `featureName`, `agent`, `adoptAgents`.

**2. Between auto-commit and merge** (between lines 1517 and 1563)
- After the feature branch's code is committed but before `git merge --no-ff` to default branch.
- Could be a hardcoded scan step (not a user hook) for tighter integration and better error messages.

**3. `feature-submit` template** (`templates/generic/commands/feature-submit.md`)
- This is a template command executed by agents, NOT a CLI handler.
- Currently has NO validation before committing — just "Stage and commit all code changes."
- Adding a scan step here catches issues at the earliest point in agent workflows.

**4. Autopilot iteration** (`lib/validation.js`, line 145)
- `ensureRalphCommit()` auto-commits after each autonomous iteration.
- Scanning here catches secrets before they accumulate across iterations.

**5. Post-merge/pre-deploy** (`lib/commands/feature.js`, lines 1832-1843)
- Last chance before `workflow.deployAfterDone` triggers. Could block deployment.

#### How `feature-close` Merges Code (flow)

1. Parse args → replay outbox if interrupted → run `pre-feature-close` hook (can abort)
2. Auto-commit uncommitted changes on feature branch (lines 1482-1517)
3. Push branch to origin (line 1521)
4. Switch to default branch: `git checkout main` (line 1540)
5. **Merge**: `git merge --no-ff {branchName}` (line 1563)
6. Record transition via `requestTransition()`, move spec to `05-done`
7. Remove worktree, delete branch, auto-deploy if configured
8. Run `post-feature-close` hook

**Key finding: there are almost no existing security checks in the codebase.** The only related code:
- `.env` filtering in `lib/git.js` (lines 42-58): filters `.env` from `getStatus()` so it doesn't block workflows — but this does NOT prevent `.env` from being committed.
- Manual review checklist in `feature.js` (line 1283-1286): includes "No hardcoded secrets" as markdown text — not automated.
- Agent deny permissions block `rm -rf /`, `sudo:*` etc. — sandbox rules, not code scanning.

#### Pluggable Scanner Config Pattern

The aigon config system uses two-tier JSON merging (`lib/config.js`):
- Global: `~/.aigon/config.json`, Project: `.aigon/config.json`
- `getEffectiveConfig()` deep-merges project > global > defaults

A scanner plugin could follow this established pattern:
```json
{
  "security": {
    "scanners": {
      "secrets": "gitleaks",
      "sast": "semgrep"
    },
    "scanOnClose": true,
    "scanOnSubmit": true,
    "blockOnFailure": true,
    "customCommand": null
  }
}
```

This mirrors the existing agent plugin pattern where users select from supported options (cc, gg, cx, cu) with a consistent config shape.

### 12. Consolidated Recommendation

**The architecture should be: defense-in-depth with three layers, each serving a different purpose.**

```
Layer 1: Pre-commit hook (gitleaks)     → Prevents secrets entering git history
    ↓ bypassed by --no-verify?
Layer 2: Aigon gate (feature-close)     → Un-bypassable scan before merge to main
    ↓ pushed to GitHub?
Layer 3: GitHub (secret scanning + CI)  → Server-side backstop, deep analysis
```

**Why this works for agent-driven workflows:**
- Layer 1 catches 90% of issues instantly (milliseconds) without slowing agents
- Layer 2 is the critical control — agents cannot bypass `aigon feature-close`
- Layer 3 catches anything that slips through (e.g., agent commits directly without aigon)

**Tool selection:**
- **Secrets**: gitleaks (MIT, offline, milliseconds, 160+ patterns, worktree-compatible via `core.hooksPath`)
- **SAST**: Semgrep (LGPL, offline, 5-30s, YAML custom rules, JSON output for programmatic parsing)
- **CI complement**: CodeQL via GitHub code scanning (free for public repos)

**Implementation priority:**
1. Ship `.githooks/pre-commit` with env-file blocking (zero dependencies, immediate value)
2. Have `install-agent` set `core.hooksPath` so hooks work across worktrees
3. Add gitleaks scan to `feature-close` as un-bypassable gate
4. Add Semgrep SAST to `feature-close` gate (configurable severity threshold)
5. Build pluggable scanner config in `.aigon/config.json`
6. Document GitHub-side setup (secret scanning, push protection, CodeQL)

## Suggested Features

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| security-scan-env-check | Block .env/.env.local files from being committed via a shipped .githooks/pre-commit script | high | none |
| security-scan-gate | Add secret/env-file scanning to feature-close and feature-submit as an un-bypassable gate | high | none |
| security-scan-sast-gate | Run Semgrep SAST scan during feature-close/feature-submit and block on high-severity findings | high | security-scan-gate |
| security-scan-hooks-setup | Have install-agent configure core.hooksPath and install .githooks for managed repos | medium | security-scan-env-check |
| security-scan-cc-hook | Use Claude Code PostCommit hook to run scanning outside git's hook mechanism | medium | security-scan-env-check |
| security-scan-pluggable | Pluggable scanner architecture allowing users to configure which tools run at which checkpoints | low | security-scan-gate |
| security-scan-gitleaks | Integrate gitleaks as the default secret scanner for pre-commit and feature-close gate | high | security-scan-gate |
| security-scan-eslint-integration | Add eslint-plugin-security to recommended ESLint config during aigon init | low | none |
| security-github-setup-guide | Add aigon doctor check for GitHub secret scanning and push protection enablement | low | none |
