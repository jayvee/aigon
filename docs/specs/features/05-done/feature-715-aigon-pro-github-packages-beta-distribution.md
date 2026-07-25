> Historical: Aigon Pro was merged into OSS by F693. This spec describes the
> tiered architecture as it existed; Aigon has no paid tier.

# Feature: aigon-pro-github-packages-beta-distribution

---
complexity: medium
---

## Summary

Publish `@senlabs/aigon-pro` as a private npm package to GitHub Packages and set up the tooling, documentation, and outreach templates needed to onboard named beta testers. Beta testers authenticate with their GitHub ID — no repo access, no source code exposure. Includes a CLI script to grant/revoke per-user package access, installation docs with a beta watermark, and a copy-paste outreach message template.

## User Stories

- [ ] As John, I can run a single command to grant a beta tester's GitHub ID access to the `@senlabs/aigon-pro` package
- [ ] As John, I have a ready-made outreach message to send when inviting a new beta tester
- [ ] As a beta tester, I can install `@senlabs/aigon-pro` using standard npm with my GitHub personal access token
- [ ] As a visitor to the docs, I can see that Pro exists, understand it's in beta, and know how to request access

## Acceptance Criteria

- [ ] `package.json` updated: `"private"` removed, `name` changed to `@senlabs/aigon-pro`, `publishConfig.registry` set to `https://npm.pkg.github.com`
- [ ] GitHub Actions workflow (`publish-pro.yml`) publishes the package on push to `main` (or on manual trigger)
- [ ] `scripts/add-beta-tester.sh <github-username>` script that uses the GitHub API (`gh` CLI) to invite a user to the package
- [ ] `scripts/remove-beta-tester.sh <github-username>` script to revoke access
- [ ] `.aigon/beta-testers/roster.tsv` has a `github_id` column added
- [ ] `docs/pro-installation.md` written with beta watermark and step-by-step install instructions
- [ ] `docs/pro-installation.md` includes a "Want access?" CTA with contact info
- [ ] Outreach message template written to `.aigon/beta-testers/outreach-template.md`
- [ ] `README.md` or `docs/` index links to the Pro installation doc

## Validation

```bash
# Confirm package.json is publish-ready
node -e "const p = require('./package.json'); console.assert(p.publishConfig, 'missing publishConfig')"

# Confirm scripts exist and are executable
ls -la scripts/add-beta-tester.sh scripts/remove-beta-tester.sh

# Dry-run publish (doesn't actually publish)
npm publish --dry-run
```

## Technical Approach

### package.json changes

Remove `"private": true`. Add:

```json
"publishConfig": {
  "registry": "https://npm.pkg.github.com",
  "access": "restricted"
}
```

Rename package from `@aigon/pro` to `@senlabs/aigon-pro`. The `@senlabs` scope maps to the `senlabs` GitHub org, consistent with the existing npm.org org.

### GitHub Actions publish workflow

Create `.github/workflows/publish-pro.yml`:
- Trigger: `workflow_dispatch` (manual) for beta phase; can add `push` to `main` later
- Uses `GITHUB_TOKEN` (built-in) — no secrets to configure
- Runs `npm publish`

### Beta tester access scripts

GitHub Packages npm packages use organization/repository collaborator permissions — there is no per-package user allowlist for user-owned packages. The practical mechanism is:

Create a private GitHub repo `aigon-pro-access` in the `senlabs` org. Add each beta tester as a repo collaborator with Read access. GitHub Packages in that org will then be installable by those collaborators. The `add-beta-tester.sh` script wraps `gh api` to add a collaborator to that access repo.

Script behavior for `add-beta-tester.sh`:
1. Takes `<github-username>` as argument
2. Calls `gh api --method PUT /repos/senlabs/aigon-pro-access/collaborators/<username> -f permission=read`
3. Prints confirmation and the install instructions URL
4. Updates `.aigon/beta-testers/roster.tsv` with `github_id` and `status=invited`

### Installation docs

`docs/pro-installation.md` — covers:
1. Prerequisite: GitHub account with granted access
2. Create a GitHub PAT with `read:packages` scope
3. Add `.npmrc` to their project: `@senlabs:registry=https://npm.pkg.github.com` + auth token
4. `npm install @senlabs/aigon-pro`
5. Basic usage snippet

Include a prominent beta notice at the top and a "Access was request-only" CTA.

### Outreach template

`.aigon/beta-testers/outreach-template.md` — a short message for inviting a new tester, asking for their GitHub ID so they can be added to the package.

## Dependencies

- Requires `gh` CLI authenticated with the `senlabs` org owner account to run the access scripts
- GitHub org `senlabs` must be created (free) and own the package namespace (`@senlabs`)
- The `senlabs` GitHub org name must be available — confirm before implementation starts

## Out of Scope

- Moving the main public `aigon` package from npm.org to GitHub Packages
- Automated billing or license key enforcement
- A web-based access request form (manual outreach only for beta)
- Publishing to npm.org at any point during beta

## Open Questions

- Should the publish workflow be manual-trigger-only during beta, or auto on every merge to `main`?
- Should `docs/pro-installation.md` live in the `aigon` public repo (for discoverability) or only in `aigon-pro`?

## Related

- `.aigon/beta-testers/roster.tsv` — current tester list
- Feature: github-repo-launch-readiness
