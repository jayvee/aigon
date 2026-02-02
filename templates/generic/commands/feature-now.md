<!-- description: Fast-track feature <name> - create + setup + implement in one step -->
# aigon-feature-now

Fast-track a feature from idea to implementation. Creates the spec, assigns an ID, sets up a solo branch, and starts implementation — all in one step.

## Argument Resolution

If no feature name is provided:
1. Ask the user what feature they want to create
2. Use a slug-friendly name (lowercase, hyphens, no spaces)

## Step 1: Explore the codebase

Before running the command, explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

## Step 2: Run the CLI command

```bash
aigon feature-now {{ARG_SYNTAX}}
```

This will:
- Create a feature spec directly in `03-in-progress/` with an assigned ID
- Create a solo branch (`feature-NN-slug`)
- Create an implementation log
- Commit everything atomically

Note the feature ID and file paths from the output.

## Step 3: Read and write the spec

Read the created spec file in `./docs/specs/features/03-in-progress/feature-*-{{ARG1_SYNTAX}}.md`

Rewrite the spec sections with content informed by your codebase exploration and the conversation context:
- **Summary**: Clear one-line description
- **Problem**: What problem this solves
- **Technical Approach**: How to implement it, based on existing patterns
- **Dependencies**: What existing code is involved
- **Acceptance Criteria**: Specific, testable criteria

Commit the spec:
```
docs: write spec for feature NN
```

## Step 4: Implement

Create tasks from the acceptance criteria to give the user visibility into progress.

Implement the feature according to the spec. Commit with conventional commits (`feat:`, `fix:`, `chore:`).

## Step 5: Test

- Start the dev server if needed
- Test the changes
- Ask the user to verify

**STOP and WAIT for user confirmation before proceeding** — do NOT continue until the user confirms testing is complete.

## Step 6: Update the implementation log

Find the log at `./docs/specs/features/logs/feature-*-log.md`

Update with:
- Key decisions made during implementation
- Summary of the approach
- Any issues encountered and resolutions

Commit the log file.

## Step 7: STOP — Implementation complete

**CRITICAL: Do NOT proceed to feature-done automatically.**

Tell the user: "Implementation complete. Ready for your review."

**STOP and WAIT** for the user to:
- Review the code changes
- Test the feature themselves
- Optionally run `{{CMD_PREFIX}}feature-eval` for code review
- Approve with `{{CMD_PREFIX}}feature-done`

**This implementation session is complete.**
