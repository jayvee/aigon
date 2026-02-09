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

Explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Plan your approach before writing. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

Use this understanding to write a well-informed spec — especially the **Technical Approach**, **Dependencies**, and **Acceptance Criteria** sections.

Next step: Once the spec is complete, run `{{CMD_PREFIX}}feature-prioritise {{ARG_SYNTAX}}` to assign an ID and move to backlog.

## Prompt Suggestion

End your response with the suggested next command on its own line. This influences Claude Code's prompt suggestion (grey text). Use the actual feature name:

`{{CMD_PREFIX}}feature-prioritise <name>`
