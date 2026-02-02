<!-- description: Create feature <name> - creates spec in inbox -->
# aigon-feature-create

Run this command followed by the feature name.

```bash
aigon feature-create {{ARG_SYNTAX}}
```

This creates a new feature spec in `./docs/specs/features/01-inbox/`.

## Before writing the spec

Explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Plan your approach before writing. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

Use this understanding to write a well-informed spec — especially the **Technical Approach**, **Dependencies**, and **Acceptance Criteria** sections.

Next step: Once the spec is complete, run `{{CMD_PREFIX}}feature-prioritise {{ARG_SYNTAX}}` to assign an ID and move to backlog.
