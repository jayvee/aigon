# Feature: security-scan-docs-and-extras

## Summary

Add Claude Code PostCommit hook integration for bypass-resistant scanning and document GitHub-side security setup (push protection, CodeQL, Dependabot) as recommended complements to local aigon scanning. Add `aigon doctor` check for GitHub secret scanning enablement.

## Acceptance Criteria

- [ ] Claude Code PostCommit hook in `.claude/settings.json` runs gitleaks on each commit
- [ ] Hook runs outside git's mechanism — cannot be bypassed by `--no-verify`
- [ ] Documentation: GitHub push protection setup guide
- [ ] Documentation: CodeQL default setup for public repos
- [ ] Documentation: Dependabot alerts configuration
- [ ] `aigon doctor` checks GitHub repo settings for secret scanning (if `gh` CLI available)

## Dependencies

- Feature: security-scan-foundation (hooks and config infrastructure)
- External: Claude Code hooks system, GitHub CLI (`gh`)

## Related

- Research: #16 security-scanning
