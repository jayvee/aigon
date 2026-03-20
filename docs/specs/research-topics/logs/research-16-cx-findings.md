# Research Findings: security scanning

**Agent:** Codex (cx)
**Research ID:** 16
**Date:** 2026-03-20

---

## Key Findings

### 1. Secret-detection tools split into two useful classes

**Gitleaks**
- Best fit for local developer hooks and simple CI. The official README exposes a fast staged-diff path via `gitleaks protect --staged` for pre-commit and a broader history/path scan via `detect`.
- Strengths: single static binary, easy to script, custom TOML rules include both regex and path matching, SARIF/JSON output available.
- Weaknesses: regex/entropy approach means more manual allowlisting and tuning than a verifier-backed scanner.
- Inference: this is the best default for Aigon because its local-hook ergonomics are the cleanest and it has the lowest operational overhead.

**TruffleHog**
- Strongest when you want high-confidence secrets rather than maximum speed. Official docs emphasize verified results and `fail verified`; CI docs show local git diff scanning between a base and head ref.
- Strengths: active verification reduces false positives; strong for CI, pre-receive, and post-fact incident hunting.
- Weaknesses: heavier runtime model, more network dependence for verification, more moving parts than Gitleaks. That is a worse fit for every autonomous agent commit unless verification is scoped carefully.
- Inference: best as an optional higher-assurance mode, not the default local hook for every Aigon user.

**detect-secrets**
- Best when teams are willing to maintain a baseline. The official README is explicit about the baseline/audit workflow: allow existing findings, block new ones, periodically audit noise.
- Strengths: enterprise-friendly workflow, strong false-positive management, inline allowlists, plugin/filter system, good pre-commit integration.
- Weaknesses: the baseline itself becomes a maintenance artifact; this is additional cognitive load for small repos and fast agent-driven branches.
- Inference: good for larger repos with existing secret debt, not the best minimal default for Aigon itself.

**git-secrets**
- Narrowest scope. Official README installs git hooks directly and focuses on prohibited/allowed regex patterns plus provider-backed exact-secret matching.
- Strengths: very simple mental model, especially for AWS-centric teams.
- Weaknesses: more static and lower-coverage than newer tools; hook installation model is more old-school and Git only allows one script per hook unless a chaining convention already exists.
- Inference: viable for users who already standardized on it, but not the best general-purpose recommendation for Node/macOS/AI-agent workflows.

### 2. Recommended secret-scanner ranking for Aigon

1. **Gitleaks** as the default local scanner
   Reason: best balance of speed, install simplicity, CLI friendliness, and configurability for staged changes plus merge-time scans.
2. **TruffleHog** as an optional high-assurance mode
   Reason: verified findings are valuable for CI and merge gates, but too heavy to make the universal default.
3. **detect-secrets** as an optional baseline-driven mode
   Reason: useful where teams already carry historical secret debt and want audit workflows.
4. **git-secrets** as a compatibility option only
   Reason: useful mostly for existing AWS-oriented shops.

### 3. JavaScript/Node SAST tools

**Semgrep**
- Best fit for Aigon CLI integration. Official docs show first-class JavaScript/TypeScript coverage, fast local CLI usage (`semgrep scan --config p/javascript`), and diff-aware CI scanning.
- Strengths: local CLI works well in scripts, strong JS/TS support, custom rules possible, easy CI exit-code gating.
- Weaknesses: best managed experience needs Semgrep platform login; rule tuning matters.
- Inference: this is the best SAST default for Aigon.

**CodeQL**
- Strong for GitHub-native CI, weaker as a local-per-commit gate. GitHub docs describe database generation plus query execution, with support for JavaScript/TypeScript and GitHub Actions integration.
- Strengths: deep analysis, high confidence, excellent GitHub integration, strong complement to PR/merge scanning.
- Weaknesses: heavier setup/runtime than Semgrep; better for CI than for every agent-side hook.
- Inference: ideal GitHub-side complement, not the first local scanner to wire into `feature-close`.

**Snyk Code**
- Good commercial option when users already pay for Snyk. Official docs expose `snyk code test`, JS/TS support, and token-based CLI auth.
- Strengths: polished SaaS workflow, interfile analysis, CLI is scriptable.
- Weaknesses: authenticated SaaS dependency adds friction for local autonomous-agent workflows and open-source defaults.
- Inference: should be supported as a plugin target, not shipped as Aigon’s default.

### 4. Where scanning should run

**Pre-commit**
- Best for secret detection.
- Reason: cheapest possible feedback loop, protects before history is created, and works regardless of whether the actor is a human or an agent in a worktree.
- Recommended tools: Gitleaks, detect-secrets, git-secrets.

**Pre-push / CI**
- Best for broader scans and higher-latency checks.
- Reason: this is the right place for full-repo secret scans, Semgrep, CodeQL, TruffleHog diff scans, and SARIF-producing jobs.
- Recommended tools: TruffleHog, Semgrep, CodeQL, Snyk Code, GitHub secret scanning / push protection.

**Aigon command gates**
- Necessary even if git hooks exist.
- Reason: agents can commit from multiple worktrees, users can bypass local hooks, and `feature-close` is the final merge choke point under Aigon’s control.
- Conclusion: Aigon should use both git-hook-level scanning and command-level merge gating.

### 5. Agent-driven workflow implications

- Fast local checks matter more than perfect analysis. A scanner that adds several seconds to every agent commit will get bypassed or disabled.
- Worktree compatibility is mostly fine because all candidate tools operate on a working tree, git diff, or git history. Aigon’s multi-worktree model does not block them.
- Verified-secret products are better at merge/push time than on every loop iteration, because network verification adds latency and can fail for environmental reasons.
- Diff-aware scanning is important. Semgrep CI and TruffleHog’s base/head git mode both align well with feature branches and agent worktrees.

### 6. Aigon integration surface is already partly present

Aigon already has a generic hook system in `lib/utils.js` that parses `docs/aigon-hooks.md` and exposes `runPreHook` / `runPostHook`. `feature-close` already invokes those hooks in `lib/commands/feature.js`. `research-close` does not currently invoke them, and I could not find a concrete CLI handler for `feature-submit` in `lib/commands/*`, even though the workflow docs and templates reference it.

That means the cleanest integration path is:

1. **Add first-class security scan orchestration to shared utils**
   Example API:
   - `runSecurityScan(stage, context)`
   - `resolveSecurityScannerConfig()`
   - `formatSecurityFailures()`

2. **Invoke it from actual Aigon choke points**
   - `feature-close` before merge
   - `research-close` before moving to done
   - any future concrete `feature-submit` handler if/when it exists
   - optional `feature-eval` or `research-synthesize` for advisory-only scans

3. **Keep existing user hook support**
   - Aigon-owned scanner integration should be first-class and structured.
   - User-defined `docs/aigon-hooks.md` should remain as an escape hatch for custom org rules.

### 7. Pluggable architecture fits existing config patterns

Aigon already merges project config over global config via `.aigon/config.json`, so scanner selection should follow the same shape as agent config rather than being hard-coded.

Proposed config shape:

```json
{
  "security": {
    "enabled": true,
    "mode": "enforce",
    "stages": {
      "preCommit": ["gitleaks"],
      "featureClose": ["gitleaks", "semgrep"],
      "researchClose": ["gitleaks"],
      "ci": ["semgrep", "codeql"]
    },
    "scanners": {
      "gitleaks": {
        "command": "gitleaks protect --staged",
        "ciCommand": "gitleaks detect --source ."
      },
      "semgrep": {
        "command": "semgrep scan --config p/javascript --error"
      },
      "trufflehog": {
        "command": "trufflehog git main HEAD --fail-verified"
      }
    }
  }
}
```

Design notes:
- `mode: "enforce" | "warn" | "off"` is important for rollout.
- Stages should be explicit because low-latency local hooks and merge-time checks are different jobs.
- Scanner definitions should permit arbitrary commands so users can bring their own tool without Aigon shipping bespoke adapters for every vendor on day one.

### 8. Recommended architecture for Aigon

**Minimal default**
- Pre-commit: `gitleaks protect --staged`
- Merge gate in `feature-close` and `research-close`: `gitleaks detect --source . --no-git` or git-range scan
- GitHub side: enable push protection and Dependabot alerts

**Best practical setup**
- Pre-commit: Gitleaks
- Merge gate / CI: Semgrep + Gitleaks
- GitHub side: push protection + CodeQL default setup + Dependabot alerts

**High-assurance option**
- Pre-commit: Gitleaks
- CI / protected branch: TruffleHog with verified-only failure plus Semgrep or CodeQL

### 9. What would have caught the `.env.local` incident?

The minimal setup I would recommend is:

1. `gitleaks protect --staged` in pre-commit
2. a tiny path-based policy that rejects `.env.local` itself
3. GitHub push protection enabled as a backstop

Why not scanner-only?
- A secret scanner may miss a low-entropy or unsupported secret value.
- The incident was not only "a secret existed"; it was also "a known local-secrets file was committed".
- The most reliable fix is therefore scanner + path policy, not scanner alone.

If forced to choose only one scanner integration, **Gitleaks pre-commit** is the best MVP.

## Sources

- Aigon hook system and config code:
  - `lib/utils.js`
  - `lib/commands/feature.js`
  - `lib/commands/research.js`
  - `lib/config.js`
- Gitleaks official README: https://github.com/confluentinc/gitleaks
- TruffleHog docs:
  - https://docs.trufflesecurity.com/scanning-in-ci
  - https://docs.trufflesecurity.com/running-the-scanner
  - https://docs.trufflesecurity.com/custom-detectors
  - https://docs.trufflesecurity.com/pre-receive-hooks
- detect-secrets official README: https://github.com/Yelp/detect-secrets
- git-secrets official README: https://github.com/awslabs/git-secrets
- Semgrep docs:
  - https://semgrep.dev/docs/
  - https://semgrep.dev/docs/languages/javascript
  - https://semgrep.dev/docs/deployment/add-semgrep-to-ci
  - https://semgrep.dev/docs/semgrep-ci/configuring-blocking-and-errors-in-ci
- GitHub CodeQL docs:
  - https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning/about-code-scanning-with-codeql
  - https://docs.github.com/en/code-security/codeql-cli
- GitHub secret scanning / push protection docs:
  - https://docs.github.com/code-security/secret-scanning/working-with-secret-scanning-and-push-protection
  - https://docs.github.com/code-security/secret-scanning/working-with-secret-scanning-and-push-protection/working-with-push-protection-from-the-command-line
- GitHub Dependabot alerts: https://docs.github.com/en/code-security/dependabot/dependabot-alerts/about-dependabot-alerts
- Snyk Code docs:
  - https://docs.snyk.io/developer-tools/snyk-cli/commands/code-test
  - https://docs.snyk.io/developer-tools/snyk-cli/authenticate-to-use-the-cli
  - https://docs.snyk.io/snyk-cli/scan-and-maintain-projects-using-the-cli/snyk-cli-for-snyk-code/scan-source-code-with-snyk-code-using-the-cli
  - https://docs.snyk.io/supported-languages/supported-languages-list/javascript/javascript-for-open-source

## Recommendation

Recommend a two-layer design:

1. Make **Gitleaks the default Aigon local secret scanner**, wired into pre-commit guidance and Aigon-owned close-time gates.
2. Make **Semgrep the default SAST scanner** for Node/JavaScript repos, but run it at merge/CI time rather than on every agent commit.
3. Expose a **pluggable `security` config block** in `.aigon/config.json` so users can swap in TruffleHog, detect-secrets, Snyk Code, or org-specific commands.
4. Add **GitHub-native backstops**: push protection, CodeQL where appropriate, and Dependabot alerts.
5. Treat **`.env.local` and similar local-secret files as a separate policy control**, because scanners alone are not guaranteed to catch every file-based accident.

If only one feature is built first, build **enforced secret scanning at `feature-close` plus optional pre-commit installation guidance**, with Gitleaks as the default engine.

## Suggested Features

<!--
Use the table format below. Guidelines:
- feature-name: Use kebab-case, be specific (e.g., "user-auth-jwt" not "authentication")
- description: One sentence explaining the capability
- priority: high (must-have), medium (should-have), low (nice-to-have)
- depends-on: Other feature names this depends on, or "none"
-->

| Feature Name | Description | Priority | Depends On |
|--------------|-------------|----------|------------|
| security-config | Add a `security` block to `.aigon/config.json` for scanner selection, stage wiring, and enforce/warn/off rollout modes. | high | none |
| security-scan-runner | Add shared scanner resolution and execution utilities that normalize command output and exit behavior across secret and SAST tools. | high | security-config |
| feature-close-security-gate | Run configured security scans before `feature-close` merges into the default branch. | high | security-scan-runner |
| research-close-security-gate | Run configured secret scanning before `research-close` marks research work complete. | medium | security-scan-runner |
| local-secret-file-policy | Add a built-in deny policy for files like `.env.local`, independent of scanner signatures. | high | security-config |
| install-security-hooks | Extend setup/install flows to optionally install pre-commit or pre-push hooks for the configured scanner set. | medium | security-config |
| semgrep-plugin | Ship a first-party Semgrep plugin preset optimized for JavaScript/Node projects. | medium | security-scan-runner |
| github-security-backstops-docs | Document GitHub push protection, CodeQL, and Dependabot as recommended complements to local Aigon scanning. | low | none |
