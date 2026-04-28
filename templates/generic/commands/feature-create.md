<!-- description: Create feature <name> - creates spec in inbox -->
# aigon-feature-create

Run this command followed by the feature name.

```bash
aigon feature-create {{ARG_SYNTAX}}
```

This creates a new feature spec in `./docs/specs/features/01-inbox/`.

**IMPORTANT:** After the CLI command completes, open the created feature file in markdown preview mode in a separate window:
- File: `./docs/specs/features/01-inbox/feature-{{ARG_SYNTAX}}.md` (or similar, check the CLI output for exact filename)
- Open the file, then use Cursor's command palette (`Cmd+Shift+P` / `Ctrl+Shift+P`) and run: `Markdown: Open Preview` (or press `Cmd+Shift+V` / `Ctrl+Shift+V`)
- This will open the markdown preview in a separate window for easy reference while you work

## Before writing the spec

> **Tip:** If you are running this command in your own Claude Code session (no `--agent` flag), press **Shift+Tab** now to enter plan mode before drafting — this keeps your session read-only while you explore the codebase and propose the spec.

Explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Plan your approach before writing. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

Use this understanding to write a well-informed spec — especially the **Technical Approach**, **Dependencies**, and **Acceptance Criteria** sections.

### Set the spec frontmatter

**`complexity:` (required)** — drives the per-agent {model, effort} **defaults** in the dashboard start modal (resolved from each agent’s `cli.complexityDefaults[<complexity>]` in `templates/agents/<id>.json`, then `aigon config`). **Do not put model names or effort levels in the spec**; those SKUs change over time and belong only in agent templates + config.

Use this rubric:

- **low** — config tweaks, doc-only changes, single-file helpers, trivial bug fixes.
- **medium** — standard feature with moderate cross-cutting; one command handler, small refactor, a new API route with clear shape.
- **high** — multi-file engine edits, new event types, new dashboard surfaces, judgment-heavy deletion work, anything that requires careful reasoning about invariants.
- **very-high** — architectural shifts, write-path-contract changes, new workflow transitions, cross-cutting template+engine+frontend. Reserve for work where a smaller model is likely to miss load-bearing detail.

**`planning_context:` (set this when you ran plan mode)** — if you entered plan mode (`EnterPlanMode` / Shift+Tab) before writing this spec and a plan file was written to `~/.claude/plans/`, set this field to that path:

```yaml
planning_context: ~/.claude/plans/your-plan-file.md
```

The implementing agent will read the plan before writing any code, and the content is copied into the implementation log at start time so it’s durable even if the plan file is later deleted. Skipping this means the agent has to re-derive all the context from the spec alone.

## After writing the spec

Commit the spec file:
```bash
git add docs/specs/features/01-inbox/
git commit -m "feat: create feature spec - <name>"
```

Next step: Once the spec is committed, suggest `{{CMD_PREFIX}}feature-prioritise {{ARG_SYNTAX}}` to assign an ID and move to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual feature name:

`{{CMD_PREFIX}}feature-prioritise <name>`
