<!-- description: Fast-track feature <name> - create + setup + implement in one step -->
# aigon-feature-now

Fast-track a feature from idea to implementation in one step. Works in two modes:

- **Existing feature**: If the name matches a feature in the inbox (`01-inbox/`), runs prioritise → setup (solo) → implement
- **New feature**: If no inbox match, creates the spec from scratch, sets up a solo branch, and starts implementation

## Argument Resolution

If no feature name is provided:
1. Ask the user what feature they want to create
2. Use a slug-friendly name (lowercase, hyphens, no spaces)

## Step 1: Check the inbox for an existing feature

List all files in `./docs/specs/features/01-inbox/` matching `feature-*.md`.

Compare the provided name/slug against the inbox filenames (partial match is fine — e.g. "ralph" matches `feature-ralph-wiggum.md`).

- **If a match is found** → go to **Path A: Fast-track existing feature**
- **If no match** → go to **Path B: Create new feature**

If multiple inbox features match, present the matches and ask the user to pick one.

---

## Path A: Fast-track existing feature

The feature already has a spec in the inbox. Prioritise it, set up solo mode, and implement.

### A1: Explore the codebase

Before starting, explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Read the existing spec to understand what's planned.

### A2: Prioritise

```bash
aigon feature-prioritise <inbox-name>
```

This assigns an ID and moves the spec from `01-inbox/` to `02-backlog/`. Note the assigned ID from the output.

### A3: Setup (solo mode)

```bash
aigon feature-setup <ID>
```

This moves the spec to `03-in-progress/`, creates the branch, and creates the implementation log.

### A4: Implement

Continue from **Step 4: Implement** below, using the assigned ID.

---

## Path B: Create new feature

No inbox match — create from scratch using the CLI.

### B1: Explore the codebase

Before running the command, explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

### B2: Run the CLI command

```bash
aigon feature-now {{ARG_SYNTAX}}
```

This will:
- Create a feature spec directly in `03-in-progress/` with an assigned ID
- Create a solo branch (`feature-NN-slug`)
- Create an implementation log
- Commit everything atomically

Note the feature ID and file paths from the output.

### B3: Read and write the spec

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

### B4: Continue to implementation

Continue from **Step 4: Implement** below.

---

## Step 3.5: Consider Plan Mode

Before implementing, **consider using plan mode** for non-trivial features:

**Use plan mode when**:
- The feature is architecturally significant
- Multiple implementation approaches exist
- The spec acceptance criteria are complex or touch many components
- You need to explore the codebase more thoroughly to understand integration points
- Architectural decisions required (patterns, libraries, structure)

**Skip plan mode for**:
- Simple, straightforward features with one obvious approach
- Single-file changes
- Features with very specific implementation details already provided
- Quick bug fixes or small enhancements

**In plan mode, you should**:
- Explore the codebase to understand existing architecture and patterns
- Design your implementation approach
- Identify all files that need changes
- Consider trade-offs between different approaches
- Present your plan for user approval before proceeding
- Exit plan mode when your plan is approved

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
