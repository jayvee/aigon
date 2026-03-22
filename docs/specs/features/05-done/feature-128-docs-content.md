# Feature: docs-content

## Summary

Fill the Fumadocs site with content: migrate README and GUIDE into structured MDX pages, auto-generate CLI command reference from `COMMAND_REGISTRY` and template descriptions, write dashboard guide showing CLI and dashboard as two views of the same workflow, and create lifecycle diagrams for feature and research flows.

## Acceptance Criteria

- [ ] Getting Started section: installation, quick start, your first feature (from README)
- [ ] Guides section: feature lifecycle, research lifecycle, Drive/Fleet/Autopilot modes, dashboard (from GUIDE)
- [ ] Reference section: individual page per CLI command with synopsis, flags, examples
- [ ] `site/scripts/gen-commands.js` auto-generates command MDX from `lib/templates.js` + template descriptions
- [ ] `npm run gen-commands` produces up-to-date command pages
- [ ] Concepts section: spec-driven development, state machine, worktrees, agent architecture (from docs/architecture.md)
- [ ] Comparisons page (from COMPARISONS.md)
- [ ] Dashboard guide with screenshots showing CLI ↔ dashboard parity
- [ ] Mermaid or SVG lifecycle diagrams for feature and research workflows
- [ ] Search indexes all content correctly
- [ ] All internal links work, no broken references

## Validation

```bash
cd site && npm run gen-commands && npm run build && echo "Build OK"
```

## Technical Approach

1. Split README into Getting Started pages (install, quick-start, first-feature)
2. Split GUIDE into Guides pages (one per workflow/mode)
3. Build `gen-commands.js` that reads `COMMAND_REGISTRY` + `templates/generic/commands/*.md` descriptions → outputs MDX
4. Write dashboard guide with paired CLI/dashboard screenshots
5. Create Mermaid diagrams: `create → prioritise → start → (do) → evaluate → close`
6. Port COMPARISONS.md with formatting improvements

## Dependencies

- Feature: docs-site-build (Fumadocs app must exist with docs layout)

## Out of Scope

- AADE/commercial documentation
- API reference (no public API yet)
- Translations / i18n

## Related

- Research: #17 new-docs-site
- Feature: docs-site-build (prerequisite)
