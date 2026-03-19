# Feature: rationalise-readme-guide

## Summary
Rationalise `README.md` and `GUIDE.md` so they reflect the current Aigon product surface, split content cleanly by audience, and remove duplicated material. The README should stay focused on positioning, quick start, and a compact workflow overview. The GUIDE should be the detailed reference for workflows, configuration, and command behavior. Both files must be updated to remove stale command references, stale architecture claims, and duplicated sections that currently increase maintenance cost and risk misleading users.

## User Stories
- [ ] As a new user, I can read the README and get an accurate picture of what Aigon is, what workflows it supports, and how to get started without being pulled into low-level reference material.
- [ ] As an existing user, I can use the GUIDE as the detailed source of truth for workflows and configuration without hitting commands or capabilities that no longer exist.
- [ ] As a maintainer, I can update one clear source for high-level docs and one clear source for detailed docs instead of keeping overlapping sections in sync.

## Acceptance Criteria
- [ ] `README.md` is reduced to high-level product explanation, accurate quick start, concise workflow summary, and links into the GUIDE for reference-heavy material.
- [ ] `GUIDE.md` becomes the detailed workflow/reference document and does not repeat long README sections unless the detail level is materially different.
- [ ] All documented commands and workflows in both files match the current CLI/help output and handler behavior.
- [ ] The docs no longer present `feature-eval` as a normal Drive/solo step if the implementation only supports Fleet comparison.
- [ ] The docs no longer claim `aigon init` installs agents or creates agent-specific files unless the implementation actually does so.
- [ ] The docs no longer refer to nonexistent dashboard subcommands such as `dashboard install`, `dashboard uninstall`, `dashboard vscode-install`, or `dashboard menubar-install` unless those commands are implemented.
- [ ] The docs no longer describe agent status as living in implementation-log front matter if the current implementation stores it in `.aigon/state/*.json`.
- [ ] The docs no longer present `aigon feedback-promote` as a current user command unless that command is implemented.
- [ ] Repeated installation/context-delivery/ownership content is consolidated so the same details are not fully restated in both files.

## Validation
```bash
node aigon-cli.js help
rg -n "feature-eval|feedback-promote|dashboard install|dashboard uninstall|dashboard vscode-install|dashboard menubar-install|status lives|front matter|project-context|check-version" README.md GUIDE.md
```

## Technical Approach
Treat the live CLI/help output and command handlers as the source of truth, then reshape the docs around that current behavior.

Recommended structure:

1. README
- Keep product framing, lifecycle explanation, quick start, supported agents, and a short workflow overview.
- Keep one compact dashboard section with a link to the GUIDE for subcommands and operational details.
- Keep one compact installation/context-delivery summary.
- Replace verbose command walkthroughs with short examples and links to GUIDE anchors.
- Remove duplicated low-level reference content already covered in the GUIDE.

2. GUIDE
- Keep detailed workflow sections for feature/research/feedback.
- Keep detailed config, hooks, proxy, dashboard, worktree, and CLI reference sections.
- Remove duplicated high-level philosophy/install-agent ownership/context sections where the README already explains them sufficiently, or reduce them to concise reference notes.
- Align every command example with the current command surface from `node aigon-cli.js help` and the command handlers in `lib/commands/*.js`.

Confirmed mismatches to correct:

- `feature-eval` is documented as part of Drive mode and solo workflows, but the current implementation rejects solo/Drive features and is Fleet-only.
- README quick start shows `aigon init` implicitly running `install-agent` and creating agent files, which the current implementation does not do.
- GUIDE dashboard section documents `dashboard install`, `dashboard uninstall`, `dashboard vscode-install`, and `dashboard menubar-install`, which are not implemented in the current `dashboard` command surface.
- GUIDE agent-status section says status is embedded in implementation log YAML front matter; current implementation writes status to `.aigon/state/feature-<id>-<agent>.json`.
- GUIDE example flow presents `aigon feedback-promote 12`, but there is no current feedback promotion command in the shipped CLI.
- Codex permission defaults are documented as `--full-auto` by default, but current config keeps Codex interactive by default and only applies `--full-auto` in autonomous mode.
- Proxy/dashboard details should be reconciled around current ports and setup wording, especially where docs mention `4100`, “No sudo”, or other outdated setup details.

High-value consolidation opportunities:

- Merge README quick-start step 2 and step 3 into one accurate setup flow.
- Remove one of the repeated `install-agent` ownership/context-delivery sections. Keep the concise user-facing version in README and the maintainer-specific version in the contributing section only if needed.
- Remove or heavily compress the GUIDE “Big Picture” section because it largely repeats README positioning.
- Keep one canonical dashboard command list and one canonical config/proxy reference instead of repeating command surfaces in several narrative sections.
- Keep one canonical explanation of how agent context reaches each tool.

## Dependencies
- Current CLI command surface in `node aigon-cli.js help`
- Current command handlers in `lib/commands/feature.js`, `lib/commands/infra.js`, `lib/commands/misc.js`, `lib/commands/feedback.js`, and `lib/commands/setup.js`
- Current config/proxy behavior in `lib/config.js`, `lib/proxy.js`, and `lib/manifest.js`

## Out of Scope
- Implementing new commands purely to preserve current docs
- Changing workflow behavior unless needed separately
- Rewriting unrelated docs outside `README.md` and `GUIDE.md`
- Adding new dashboard features, feedback-promotion commands, or status-tracking architecture

## Open Questions
- Should `feature-eval` remain Fleet-only and the docs be corrected, or should solo/Drive evaluation support be implemented separately?
- Should dashboard integrations like VS Code sidebar and menubar be removed from docs entirely, or moved to roadmap/future-work language if still planned?
- Should the maintainer-specific install/context details live only in `AGENTS.md` and `docs/architecture.md`, with the GUIDE linking there instead of repeating them?

## Related
- Research:
- Docs reviewed: `README.md`, `GUIDE.md`
- Source of truth for command help: `templates/help.txt`
- Relevant code: `lib/commands/feature.js`, `lib/commands/infra.js`, `lib/commands/misc.js`, `lib/commands/feedback.js`, `lib/commands/setup.js`, `lib/config.js`, `lib/proxy.js`, `lib/manifest.js`
