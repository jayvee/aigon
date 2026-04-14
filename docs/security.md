# Security Scanning

Aigon uses a defense-in-depth approach to prevent secrets and vulnerabilities from reaching production.

## Layer 1: Pre-commit Hook (Local)

A git pre-commit hook blocks `.env` and `.env*.local` files from being committed. Installed automatically by `aigon install-agent` via `core.hooksPath=.githooks`.

This is a standard git hook — it can be bypassed with `git commit --no-verify`.

## Layer 2: Aigon Merge Gate (Local, Un-bypassable)

At `feature-close`, `aigon agent-status submitted`, and `research-close`, aigon runs gitleaks on all changed files (diff vs default branch). This is an aigon command, not a git hook — it cannot be bypassed.

Modes: `enforce` (block), `warn` (log and continue), `off` (skip). Configured in `.aigon/config.json`:

```json
{
  "security": {
    "mode": "enforce",
    "mergeGateStages": {
      "featureClose": ["gitleaks"],
      "featureSubmit": ["gitleaks"],
      "researchClose": ["gitleaks"]
    }
  }
}
```

## Layer 3: GitHub Server-Side Protection

GitHub provides server-side security features that act as a final backstop. These are recommended complements to local scanning.

### Secret Scanning & Push Protection

GitHub scans commits for known secret patterns (API keys, tokens, passwords) and can block pushes that contain them.

**Setup via GitHub UI:**

1. Go to **Settings > Code security** in your repository
2. Under **Secret scanning**, click **Enable**
3. Enable **Push protection** — this blocks pushes containing detected secrets

**Setup via GitHub CLI:**

```bash
# Enable secret scanning
gh api repos/{owner}/{repo} --method PATCH \
  -f security_and_analysis[secret_scanning][status]=enabled

# Enable push protection
gh api repos/{owner}/{repo} --method PATCH \
  -f security_and_analysis[secret_scanning_push_protection][status]=enabled
```

**Verify:**

```bash
gh api repos/{owner}/{repo} --jq '.security_and_analysis.secret_scanning.status'
# Should output: enabled
```

Push protection prevents secrets from being pushed even if they pass local checks. Contributors can bypass with a reason (which is logged), and repository admins are notified.

### CodeQL (Code Scanning)

CodeQL performs static analysis (SAST) to find security vulnerabilities, bugs, and code quality issues. Free for public repositories.

**Setup via GitHub UI:**

1. Go to **Settings > Code security**
2. Under **Code scanning**, click **Set up** > **Default**
3. GitHub auto-detects languages and configures the analysis

**Setup via GitHub CLI:**

```bash
# Enable default CodeQL setup
gh api repos/{owner}/{repo}/code-scanning/default-setup --method PATCH \
  -f state=configured
```

Default setup automatically:
- Detects languages in your repository
- Runs on every push to the default branch and on pull requests
- Uses the `security-extended` query suite
- Creates alerts in the **Security** tab

For custom configuration (additional queries, specific languages), create `.github/workflows/codeql.yml` instead.

### Dependabot Alerts & Security Updates

Dependabot monitors your dependencies for known vulnerabilities and can automatically create pull requests to update them.

**Setup via GitHub UI:**

1. Go to **Settings > Code security**
2. Enable **Dependabot alerts** — notifies you of vulnerable dependencies
3. Enable **Dependabot security updates** — auto-creates PRs to fix vulnerabilities

**Setup via GitHub CLI:**

```bash
# Enable vulnerability alerts
gh api repos/{owner}/{repo}/vulnerability-alerts --method PUT

# Check if enabled
gh api repos/{owner}/{repo}/vulnerability-alerts --include 2>&1 | head -1
# 204 = enabled, 404 = disabled
```

**Optional: Dependabot version updates** keep dependencies up-to-date proactively. Create `.github/dependabot.yml`:

```yaml
version: 2
updates:
  - package-ecosystem: npm
    directory: /
    schedule:
      interval: weekly
    open-pull-requests-limit: 10
```

## Checking Your Setup

Run `aigon doctor` to verify:
- Pre-commit hook is installed
- Git `core.hooksPath` is configured
- `.env.local` is gitignored
- GitHub secret scanning is enabled (requires `gh` CLI)

## Installing Gitleaks

Gitleaks is required for Layers 2 and 3. Install it:

```bash
# macOS
brew install gitleaks

# Linux
# Download from https://github.com/gitleaks/gitleaks/releases

# Verify
gitleaks version
```

If gitleaks is not installed, scanning is skipped with a warning (graceful degradation).
