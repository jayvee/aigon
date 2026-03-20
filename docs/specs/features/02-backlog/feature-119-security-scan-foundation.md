# Feature: security-scan-foundation

## Summary

Ship the foundational security scanning infrastructure: a `.githooks/pre-commit` script that blocks `.env*` files from being committed, a `security` config block in `.aigon/config.json` for scanner selection and modes, and `install-agent` integration to set `core.hooksPath` so hooks work across all worktrees. This is the zero-dependency first step that would have prevented the `.env.local` incident.

## Acceptance Criteria

- [ ] `.githooks/pre-commit` script exists in the aigon repo, blocks commits containing `.env`, `.env.local`, `.env*.local` files
- [ ] Pre-commit hook exits non-zero with a clear error message when a blocked file is staged
- [ ] `install-agent` sets `core.hooksPath=.githooks` in the repo's git config
- [ ] Hooks work in worktrees (verified by creating a worktree and attempting to commit `.env.local`)
- [ ] `security` config block added to `.aigon/config.json` schema with `enabled`, `mode` (enforce/warn/off), `stages`, `scanners` keys
- [ ] `getEffectiveConfig()` merges security config from global → project as with existing config
- [ ] `aigon doctor` warns if `core.hooksPath` is not configured for the repo
- [ ] `aigon doctor --fix` sets `core.hooksPath=.githooks` if missing
- [ ] `aigon init` includes `.githooks/pre-commit` and `.env*.local` in `.gitignore` for new repos

## Validation

```bash
node -c lib/commands/setup.js
node -c lib/config.js
# Verify hook blocks .env.local commit:
# touch /tmp/test-env && git add /tmp/test-env should pass
# Verify hook is installed after install-agent
```

## Technical Approach

1. Create `.githooks/pre-commit` shell script (no external dependencies):
   ```bash
   #!/bin/bash
   if git diff --cached --name-only | grep -qE '\.env(\..*)?\.local$|^\.env$'; then
     echo "ERROR: Attempting to commit environment file with secrets"
     git diff --cached --name-only | grep -E '\.env'
     echo "Remove with: git reset HEAD <file>"
     exit 1
   fi
   ```

2. In `install-agent` (`lib/commands/setup.js`): after installing agent files, run `git config core.hooksPath .githooks` if not already set.

3. In `lib/config.js`: add `security` to the default config schema. Merge it via existing `getEffectiveConfig()`.

4. In `doctor` (`lib/commands/setup.js`): add check for `core.hooksPath`, warn/fix if missing.

5. In `init`: scaffold `.githooks/pre-commit` and add `.env*.local` to `.gitignore`.

## Dependencies

- None. Zero external dependencies.

## Out of Scope

- Running gitleaks or any external scanner (that's feature 2: merge-gate)
- SAST scanning
- CI integration
- Claude Code hook integration

## Related

- Research: #16 security-scanning
- Incident: `.env.local` committed and pushed to GitHub
- Feature: security-scan-merge-gate (builds on this foundation)
