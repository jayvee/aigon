---
complexity: medium
---

# Feature: enrich command reference docs with richer descriptions

## Summary

The aigon docs site at `/site/content/reference/commands/` has ~47 MDX command pages. Some (e.g. `feature-reset`) are rich with step-by-step breakdowns, examples, and comparison tables. Many others (e.g. `research-eval`, `research-do`, `feature-eval`) contain only a synopsis, shortcuts, flags, and a single-sentence description extracted from the template HTML comment.

This feature has an agent audit every command page, read the corresponding template (`templates/generic/commands/*.md`) and implementation (`lib/commands/*.js`) to understand each command's intent, then update the MDX pages with substantially richer user-facing descriptions — covering what the command does, when to use it, step-level detail, and worked examples.

## User Stories

- [ ] As a new aigon user looking up `research-eval`, I can read a clear explanation of what the command does, what output it produces, and a worked example — rather than just the one-sentence description that duplicates the synopsis.
- [ ] As an aigon user unsure which command to run, I can read a "When to use" or "Related commands" section that points me to the right command for my situation.

## Acceptance Criteria

- [ ] Every command page in `site/content/reference/commands/` has a `## Description` section of at least 3 substantive sentences (not just a restatement of the synopsis).
- [ ] Every command page that describes a multi-step workflow includes a `## What it does` or equivalent section breaking down the key steps.
- [ ] At least one worked example (e.g. `## Examples`) is present on every page where the command takes arguments.
- [ ] Pages for commands with natural counterparts (e.g. `research-start` / `research-submit`, `feature-eval` / `feature-code-review`) include a `## Related` section.
- [ ] All MDX files remain valid (no broken JSX/MDX syntax), and the docs site builds without errors (`npm run build` from `site/`).
- [ ] The command index page (`cli-commands.mdx`) descriptions are updated to match the enriched one-liners.

## Validation

```bash
cd site && npm run build 2>&1 | tail -20
```

## Pre-authorised

- May edit any `.mdx` file under `site/content/reference/commands/` and `site/content/docs/reference/`.
- May edit `site/scripts/gen-commands.js` if adding a richer extraction mechanism, but must not change existing generated structure in a way that breaks current pages.
- May skip `npm run test:ui` — this feature touches only docs MDX files and the gen-commands script, no dashboard assets.

## Technical Approach

**Discovery:** The MDX pages live at two possible locations (investigate which is canonical/committed):
- `site/content/reference/commands/{domain}/{command-name}.mdx` (organised by domain subdir)
- `site/content/docs/reference/commands/{command-name}.mdx` (flat, as gen-commands.js outputs)

Start by checking git-tracked files to confirm the canonical location.

**Authoring approach (two options — pick simpler):**

1. **Direct MDX edits** — The agent edits the committed MDX files directly, adding richer sections. These files are in the repo and can be committed. The gen-commands.js script is only run intentionally (`npm run gen-commands`) and would overwrite enriched content. To prevent regression, add a warning comment at the top of gen-commands.js and note this in AGENTS.md.

2. **Extend gen-commands.js** — Add support for a `<!-- docs-extended: -->` multi-line block in each template. The script extracts and includes it. The agent then populates that block for each template. Advantage: enrichments survive a future `npm run gen-commands` run. Disadvantage: more complex template format.

**Recommendation:** Option 1 (direct MDX edits) unless the agent determines that gen-commands is run as part of any automated pipeline. Check `package.json` scripts and CI config first.

**Execution order:** Process all commands in one pass, grouped by domain. For each command:
1. Read current MDX page
2. Read the template (`templates/generic/commands/<name>.md`) for intent and step detail
3. Read the implementation (`lib/commands/<name>.js` or equivalent) for flags and side-effects
4. Rewrite the MDX with enriched sections, preserving existing frontmatter and Synopsis/Shortcuts/Flags blocks

## Dependencies

- None

## Out of Scope

- Changing the gen-commands.js auto-generation pipeline architecture (unless needed to prevent regressions)
- Adding new commands to the registry
- Writing guide-style docs (those live in `site/content/guides/`)
- Translating docs

## Open Questions

- Are the MDX files in `site/content/reference/commands/{domain}/` the committed canonical pages, or is there a flat `docs/reference/commands/` directory that is canonical? (Check `git ls-files site/content`)
- Is `npm run gen-commands` ever run in CI? If yes, direct MDX edits will be overwritten and Option 2 (extend gen-commands) is required.

## Related

- Research: none
- Set: standalone
