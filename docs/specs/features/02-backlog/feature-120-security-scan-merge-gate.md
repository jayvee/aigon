# Feature: security-scan-merge-gate

## Summary

Add an un-bypassable security scan gate to `feature-close`, `feature-submit`, and `research-close` that runs configured scanners before merging to main. Integrates gitleaks as the default secret scanner. Supports pluggable scanner configuration so users can swap in TruffleHog, detect-secrets, or custom commands. This is the critical control — agents can bypass `--no-verify` on git hooks, but cannot bypass `aigon feature-close`.

## Acceptance Criteria

- [ ] `feature-close` runs security scan before `git merge` — blocks merge if scan fails in enforce mode
- [ ] `feature-submit` runs security scan before signaling completion
- [ ] `research-close` runs security scan before moving to done
- [ ] Gitleaks is the default scanner — detects secrets in the branch diff (staged + committed changes vs main)
- [ ] Scan runs on the diff between feature branch and default branch (not full repo history)
- [ ] Clear error output showing which files/lines contain detected secrets
- [ ] `security.mode: "enforce"` blocks the operation; `"warn"` prints warnings but continues; `"off"` skips scanning
- [ ] Scanner config in `.aigon/config.json` controls which scanners run at which stages
- [ ] Users can add custom scanner commands: `"scanners": { "custom": { "command": "my-scanner --diff" } }`
- [ ] Graceful degradation: if gitleaks is not installed, warn and continue (don't break the workflow)
- [ ] Scan results logged to console with clear pass/fail indication

## Validation

```bash
node -c lib/commands/feature.js
node -c lib/commands/research.js
node -c lib/utils.js
```

## Technical Approach

1. Add `runSecurityScan(stage, context)` to `lib/utils.js` (or new `lib/security.js`):
   - Reads scanner config from `getEffectiveConfig().security`
   - Resolves which scanners run for the given stage
   - Executes each scanner via `execSync`, captures output
   - Returns `{ passed: bool, failures: [...] }`

2. Default scanner config:
   ```json
   {
     "security": {
       "enabled": true,
       "mode": "enforce",
       "stages": {
         "featureClose": ["gitleaks"],
         "featureSubmit": ["gitleaks"],
         "researchClose": ["gitleaks"]
       },
       "scanners": {
         "gitleaks": {
           "command": "gitleaks detect --source . --no-git --exit-code 1"
         }
       }
     }
   }
   ```

3. Integration points in `lib/commands/feature.js`:
   - Before merge in `feature-close` (between push and `git merge --no-ff`)
   - In `feature-submit` template or handler

4. Gitleaks diff scanning: use `gitleaks detect --log-opts="{defaultBranch}..HEAD"` to scan only the feature branch diff.

5. Pluggable architecture: scanner definitions are arbitrary commands. Aigon ships gitleaks config as default, users override in `.aigon/config.json`.

## Dependencies

- Feature: security-scan-foundation (config schema, `core.hooksPath` setup)
- External: gitleaks (`brew install gitleaks`) — but graceful degradation if not installed

## Out of Scope

- Semgrep/SAST integration (that's feature 3: security-scan-sast)
- CI pipeline configuration
- GitHub-side setup
- Claude Code hook integration

## Related

- Research: #16 security-scanning
- Feature: security-scan-foundation (prerequisite)
- Feature: security-scan-sast (extends this with SAST)
