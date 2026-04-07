# Feature: add reference pages for init, install-agent, doctor

## Summary
The first three commands a new Aigon user touches — `aigon init`, `aigon install-agent`, and `aigon doctor` — have **no dedicated reference pages** in the docs site. They're mentioned narratively in `getting-started.mdx` and `agents.mdx`, but a user looking up "doctor" or "init" in the CLI reference sidebar won't find them. This feature adds three thin reference pages that mostly link back to the narrative docs but exist as discoverable entries in the command index.

## User Stories

- [ ] As a returning user looking up "what does `aigon doctor` actually do", I can find a dedicated reference page for it in the CLI sidebar
- [ ] As a new user landing in the reference section, I can see all the commands I'll need to start (init, install-agent, doctor) listed alongside the feature/research/feedback commands
- [ ] As someone integrating Aigon into a script, I can find the synopsis/flags/exit codes for `init`, `install-agent`, and `doctor` in one place

## Acceptance Criteria

- [ ] **AC1** — `site/content/reference/commands/infra/init.mdx` exists with: synopsis, description, options, exit codes, related links (to getting-started.mdx and agents.mdx)
- [ ] **AC2** — `site/content/reference/commands/infra/install-agent.mdx` exists with: synopsis covering single + multi-agent install, list of supported agent codes (cc, gg, cx, cu), what files are written per agent (link to agents.mdx for the full table)
- [ ] **AC3** — `site/content/reference/commands/infra/doctor.mdx` exists with: what `doctor` checks (Node version, git version, tmux, agent installs, server status, etc.), example output, common failure modes
- [ ] **AC4** — `site/content/reference/commands/infra/_meta.js` updated to include the three new pages in the nav, in a sensible order (init first, then install-agent, then doctor early in the list since they're setup commands)
- [ ] **AC5** — Each new page is < 100 lines — these are reference pages, not tutorials. Defer to narrative docs for any explanation longer than 2 paragraphs.
- [ ] **AC6** — `npm run --prefix site build` succeeds (catches MDX syntax issues)
- [ ] **AC7** — Manual visual check: navigate to /docs/reference/commands/infra/ in dev and confirm the new pages render and appear in the sidebar

## Validation
```bash
cd site && npm run build && cd ..
test -f site/content/reference/commands/infra/init.mdx
test -f site/content/reference/commands/infra/install-agent.mdx
test -f site/content/reference/commands/infra/doctor.mdx
grep -l init site/content/reference/commands/infra/_meta.js
```

## Technical Approach

### Sources for the content

Each command's accurate behaviour is in `lib/commands/setup.js` (init, install-agent, doctor are all there). Read that file first to extract the actual flags and behaviour. Don't invent features.

The narrative versions in `getting-started.mdx` and `agents.mdx` are the right tone — straightforward, example-led. Match their style.

### Page templates

Each new file follows the existing reference page pattern (look at `site/content/reference/commands/infra/board.mdx` or `agent-status.mdx` as templates):

```
---
title: <command name>
description: <one-line description>
---

## Synopsis

\```bash
aigon <command> [args]
\```

## Description

<2-3 sentence description>

## Options

<table or bullets>

## Exit codes

<table>

## Examples

<2-3 short examples>

## See also

- [Getting Started](/docs/getting-started)
- ...
```

### Recommended order in `_meta.js`

The current infra menu lists commands alphabetically-ish. The setup commands should come first since they're the natural reading order for a new user:

```js
{
  init: "init",
  "install-agent": "install-agent",
  doctor: "doctor",
  board: "board",
  server: "server",
  // ... rest
}
```

## Dependencies
- None — pure docs work, no code changes

## Out of Scope

- Adding reference pages for the other documentation gaps from the same audit (`feature-spec`, `feature-status`, `commits`, `config`) — those are P2 power-user commands and can be a separate feature
- Restructuring the rest of the infra command sidebar
- Adding tutorials or how-to guides (these are reference pages only)

## Open Questions

- Should `install-agent` have one combined page or one per agent? Recommend one combined page that lists all agents and links to `agents.mdx` for per-agent specifics.
- Should `doctor` document every check it runs, or just the categories? Recommend categories to keep it short and avoid drift when checks are added/removed.

## Related

- Discovered during the 2026-04-07 site audit before launch
- `lib/commands/setup.js` — actual implementation of init, install-agent, doctor
- `site/content/getting-started.mdx` — narrative version of init/install-agent
- `site/content/reference/agents.mdx` — narrative version of install-agent (per-agent details)
- `site/content/reference/commands/infra/_meta.js` — nav menu to update
