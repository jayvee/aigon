# Feature: github-repo-launch-readiness

## Summary

Prepare the Aigon GitHub repo to convert marketing traffic into stars, installs, and engagement. This combines README optimisation, community surface fixes, and awesome-list submissions into a single "repo readiness" feature that must ship before any launch campaigns.

## User Stories

- [ ] As a developer discovering Aigon via HN/Reddit/X, I immediately understand what Aigon does and why it's different within the first 50 words and a demo GIF
- [ ] As a visitor, I can reach a working community discussion surface from the README
- [ ] As a developer browsing awesome-lists or GitHub topics, I can discover Aigon organically

## Acceptance Criteria

- [ ] README has a demo GIF/video above the fold showing multi-agent orchestration
- [ ] README has a star history chart (star-history.com embed)
- [ ] Custom social preview image (1280x640px) set on the repo
- [ ] All 20 GitHub topic tags filled (ai-coding, agent-orchestration, claude, ai-agents, developer-tools, cli, multi-agent, workflow-automation, spec-driven-development, coding-assistant, etc.)
- [ ] Explicit star CTA in README ("If this helps you, a star would mean a lot")
- [ ] Contributor avatars section (contrib.rocks)
- [ ] Repobeats activity graph
- [ ] GitHub Discussions link either fixed or replaced with working community path
- [ ] Clear community/contact CTA on aigon.build
- [ ] Submitted to at least 5 relevant awesome-lists (awesome-ai-agents, awesome-llm-apps, awesome-developer-tools, awesome-cli-apps, awesome-selfhosted)

## Validation

```bash
# Check social preview is set, topics are populated, discussions link works
```

## Technical Approach

Work directly on the public Aigon repo (not aigon-pro). README changes, GitHub settings, and awesome-list PRs.

## Dependencies

- none

## Out of Scope

- Blog/content pipeline (separate feature)
- Paid advertising
- Product Hunt or Show HN launch execution

## Open Questions

- Should GitHub Discussions be enabled, or should we point to a different community surface (Discord, etc.)?
- Which awesome-lists have minimum star requirements we don't yet meet?

## Related

- Research: #25 marketing-aigon
