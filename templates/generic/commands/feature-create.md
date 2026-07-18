<!-- description: Create feature <name> - creates spec in inbox -->
# aigon-feature-create

Run this command followed by the feature name.

```bash
aigon feature-create {{ARG_SYNTAX}}
```

This creates a new feature spec in `./docs/specs/features/01-inbox/`.

**IMPORTANT:** Do not launch or foreground an editor, terminal, or Markdown
preview after creation. Continue by reading and editing the spec through the
current agent session; use the exact path printed by the CLI.

## Before writing the spec

> **Tip:** If you are running this command in your own Claude Code session (no `--agent` flag), press **Shift+Tab** now to enter plan mode before drafting — this keeps your session read-only while you explore the codebase and propose the spec.

Explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Plan your approach before writing. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

Use this understanding to write a well-informed spec — especially the **Technical Approach**, **Dependencies**, and **Acceptance Criteria** sections.

### Feature sets (`set:` frontmatter)

**Default: standalone.** Most new specs should **not** have a `set:` tag.

Use `set: <slug>` only when you are creating **two or more inbox specs** that ship together and will be prioritised with `aigon set-prioritise <slug>`.

**Before reusing any set slug**, run `aigon set show <slug>`. If every member is `done`, the set is **closed** — do **not** tag into it. For follow-up work, use `depends_on: [<id>]` and mention prior features under `## Related` instead.

See `.aigon/docs/feature-sets.md` § *Completed sets — do not rejoin*.

### Set the spec frontmatter

**`complexity:` (required)** — drives the per-agent {model, effort} **defaults** in the dashboard start modal, resolved from each agent's complexity-defaults table and then `aigon config`. **Do not put model names or effort levels in the spec**; those SKUs change over time and belong only in agent config.

Use this rubric:

- **low** — config tweaks, doc-only changes, single-file helpers, trivial bug fixes.
- **medium** — standard feature with moderate cross-cutting; one command handler, small refactor, a new API route with clear shape.
- **high** — multi-file changes, new public surfaces, judgment-heavy deletion work, anything that requires careful reasoning about invariants.
- **very-high** — architectural shifts, write-path-contract changes, new workflow transitions, cross-cutting template+engine+frontend. Reserve for work where a smaller model is likely to miss load-bearing detail.

**`planning_context:` (set this when you ran plan mode)** — if you entered plan mode (`EnterPlanMode` / Shift+Tab) before writing this spec and a plan file was written to `~/.claude/plans/`, set this field to that path:

```yaml
planning_context: ~/.claude/plans/your-plan-file.md
```

The implementing agent will read the plan before writing any code, and the content is copied into the implementation log at start time so it’s durable even if the plan file is later deleted. Skipping this means the agent has to re-derive all the context from the spec alone.

## After writing the spec

Promote every durable product decision into the spec, then record a compact
author handoff. Derive the active author identity through `agent-context`; do
not copy provider session IDs or transcripts manually:

```bash
eval "$(aigon agent-context --shell)"
aigon feature-context record <ID> --file=<handoff.json>
```

The handoff JSON contains `decisions`, `constraints`, `nonGoals`,
`unresolvedQuestions`, `implementationNotes`, and `specReferences` arrays.

Commit the spec file:
```bash
git add docs/specs/features/01-inbox/ .aigon/context/features/
git commit -m "feat: create feature spec - <name>"
```

Next step: Once the spec is committed, suggest `{{CMD_PREFIX}}feature-prioritise {{ARG_SYNTAX}}` to assign an ID and prioritise it to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This helps agent UIs surface the next suggested Aigon command. Use the actual feature name:

`{{CMD_PREFIX}}feature-prioritise <name>`
