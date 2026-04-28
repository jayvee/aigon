---
complexity: medium
transitions:
  - { from: "inbox", to: "backlog", at: "2026-04-28T00:36:25.554Z", actor: "cli/feature-prioritise" }
---

# Feature: planning context injection via spec frontmatter

## Summary
Add a `planning_context:` frontmatter field to feature specs. When `feature-do` runs, it reads this field and injects a "read this before coding" section — exactly as `research:` injects research findings and `set:` injects completed sibling logs. The use case: a user has a rich interactive planning session with Claude Code, generates a plan file (e.g. `~/.claude/plans/mossy-chasing-moore.md`), and wants to carry that reasoning into an isolated worktree agent that has no memory of the conversation. The plan file content is also copied into the implementation log at `feature-start` time so the context is durable and repo-resident, not dependent on an external file that could be deleted.

## User Stories
- [ ] As a user who planned a feature in a Claude Code session, I add `planning_context: ~/.claude/plans/my-plan.md` to the spec before running `feature-start`, and the implementing agent reads that plan before it writes any code.
- [ ] As a user who doesn't have a plan file, the absence of `planning_context:` is a no-op — nothing changes.
- [ ] As a user running `feature-start`, the plan file's content is copied into the implementation log under a `## Planning Context` section so it's preserved in the repo even if the original plan file is later deleted.

## Acceptance Criteria
- [ ] `planning_context:` is parsed from spec frontmatter in `lib/cli-parse.js parseFrontMatter` (alongside existing `research:`, `set:`, `complexity:`)
- [ ] `feature-do` reads the field and, if present, generates a "Step 2.7: Planning context" section instructing the agent to read the file before coding (mirrors the `buildResearchContextSection` pattern in `lib/feature-do.js`)
- [ ] `feature-start` detects `planning_context:`, resolves `~` to `os.homedir()`, reads the file, and appends its content as a `## Planning Context` section in the implementation log starter — so the agent has a durable, repo-resident copy
- [ ] If the plan file path doesn't exist at `feature-start` time, a warning is printed but the start is not blocked
- [ ] If the plan file path doesn't exist at `feature-do` time (file deleted after start), the section falls back gracefully to pointing at the implementation log's `## Planning Context` section instead
- [ ] `planning_context:` accepts a single path or a list of paths
- [ ] `npm test` passes
- [ ] `site/content/getting-started.mdx` — the "Context that compounds" bullet (~line 12) is updated to mention that planning mode artifacts carry forward: something like "specs, implementation summaries, and planning session notes feed forward — context from an interactive session is never lost when work moves to an isolated agent"
- [ ] `site/content/guides/drive-mode.mdx` — a tip/callout is added after the "Create a feature" code block (~line 47) explaining that if you designed the feature in a Claude Code planning session, you can add `planning_context: ~/.claude/plans/<file>.md` to the spec frontmatter and the implementing agent will read that plan before writing any code; include a one-line example showing the frontmatter field

## Validation
```bash
node -e "
const {parseFrontMatter} = require('./lib/cli-parse');
const result = parseFrontMatter('---\ncomplexity: medium\nplanning_context: ~/.claude/plans/test.md\n---\n# Title');
console.assert(result.planning_context === '~/.claude/plans/test.md', 'single path not parsed');
console.log('parseFrontMatter OK');
"
```

## Pre-authorised
- May skip `npm run test:ui` mid-iteration when this iteration touches no dashboard assets (`templates/dashboard/**`, `lib/dashboard*.js`, `lib/server*.js`). Playwright still runs at the pre-push gate.

## Technical Approach

### Why this likely improves agent performance
`research:` context injection demonstrably reduces agent mistakes: the agent knows *why* a feature was created, what constraints the research surfaced, and what was ruled out. A plan file carries equivalent signal — the file paths the explorer found, the before/after diffs agreed on, the decisions made. An agent without it has to re-derive all of that from the spec alone, which is lossy for anything non-trivial. The spec captures *what*; the plan captures *why* and *what was considered and rejected*.

### 1. `lib/cli-parse.js` — parse the new field
`parseFrontMatter` already returns arbitrary YAML keys. Add `planning_context` to the set of recognised fields (alongside `complexity`, `research`, `agent`). Normalise to an array of strings (single path or list both work).

### 2. `lib/feature-do.js` — inject into agent context
Add `buildPlanningContextSection(planningContextPaths, repoRoot)` function, modelled on `buildResearchContextSection`:
- Resolve `~` → `os.homedir()` for each path
- Check if each file exists on disk
- If exists: include path with instruction "read before coding, focus on: design decisions, file paths, before/after diffs, and constraints"
- If not exists: fall back to "see `## Planning Context` in the implementation log" (the durable copy written at feature-start)
- Returns a "Step 2.7: Planning context" section string, or `''` if nothing to inject

Wire it into `feature-do`'s placeholder map as `PLANNING_CONTEXT_SECTION`, and add `{{PLANNING_CONTEXT_SECTION}}` to `templates/generic/commands/feature-do.md` between `{{RESEARCH_CONTEXT_SECTION}}` and `{{WORKTREE_DEP_CHECK}}`.

### 3. `lib/feature-start.js` (or implementation log starter) — write durable copy
At feature-start time, after the implementation log starter is written:
- Read `planning_context` from the spec frontmatter
- Resolve and read each file (warn + skip if missing)
- Append a `## Planning Context` section to the log file with the full content of each plan file

This makes the context repo-resident and present in the worktree. The agent in the worktree reads the log (which feature-do already points to via the set/research patterns) and gets the full plan.

### 4. `templates/generic/commands/feature-do.md`
Add `{{PLANNING_CONTEXT_SECTION}}` placeholder between `{{RESEARCH_CONTEXT_SECTION}}` and `{{WORKTREE_DEP_CHECK}}`.

### Key files
- `lib/cli-parse.js` — frontmatter parsing
- `lib/feature-do.js` — context section builder + placeholder wiring
- `lib/feature-start.js` — implementation log appender
- `templates/generic/commands/feature-do.md` — placeholder slot
- `site/content/getting-started.mdx` — update "Context that compounds" bullet (~line 12)
- `site/content/guides/drive-mode.mdx` — add tip after "Create a feature" code block (~line 47)

## Dependencies
- none

## Out of Scope
- UI surface for `planning_context:` in the dashboard
- Auto-populating `planning_context:` from the active plan file — user sets this manually (or a future feature automates it)
- Context injection for research specs (separate concern, similar pattern if needed later)

## Open Questions
- Should the plan content be *inlined* in the feature-do output (like the spec is), or just referenced as a path? Inlining increases token cost but removes a file-read step. Recommendation: reference as a path (consistent with how research/set context works — the agent reads the file, it's not dumped wholesale).
- **No backfill path needed.** The log-copy step is intentionally forward-only (fires at `feature-start`). For in-flight features, a user can manually add `planning_context:` to the spec and `feature-do` will pick it up at next run — the live file path works fine without the log copy. Do not add any backfill or migration logic.

## Related
- Research: none
- Set: none
