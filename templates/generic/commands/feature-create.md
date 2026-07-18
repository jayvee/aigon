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

## Step 1: Read Project Conventions

> **Tip:** If you are running this command in your own Claude Code session (no `--agent` flag), press **Shift+Tab** now to enter plan mode before drafting — this keeps your session read-only while you explore the codebase and propose the spec.

Explore the codebase to understand the existing architecture, patterns, and code relevant to this feature. Use that investigation both to plan the approach and to resolve technical facts without asking the user. Consider:

- What existing code will this feature interact with?
- Are there patterns or conventions in the codebase to follow?
- What technical constraints or dependencies exist?

Use this understanding to write a well-informed spec — especially the **Technical Approach**, **Dependencies**, and **Acceptance Criteria** sections.

## Step 2: Deepen — interview the user before writing

Follow this procedure literally. Deepen applies to this installed agent command;
the bare `aigon feature-create` CLI remains a noninteractive scaffolder.

1. **Apply the gate.** Inspect the raw invocation arguments in the command above.
   If they contain `--quick`, skip the rest of Deepen and continue to Step 3.
   Otherwise run:

   ```bash
   aigon config get deepen.enabled
   ```

   Skip the rest of Deepen only when the effective value is `false`. Remember
   whether a value of `true` was reported as `(from default)` or came from
   explicit project/global configuration; this controls the final hint below.
2. **Build a coverage map before asking anything.** Read the user's request, the
   bare-bones spec just created, any available planning context, and the relevant
   code. If the in-flight spec has `planning_context:`, read that plan and use it
   as the source of recommended answers. Do not re-interview the user about
   decisions already resolved there. Investigate discoverable technical facts —
   including existing patterns, dependencies, constraints, and file paths —
   instead of asking the user for them.
3. **Check coverage internally in dependency order:** Summary → User Stories →
   Acceptance Criteria → Technical Approach → Dependencies → Out of Scope →
   `complexity:`. This is a decision dependency order, not a requirement to ask
   one question for every section. Ask only when the answer could materially
   change scope, acceptance criteria, or approach.
4. **Ask the highest-leverage unresolved question, one question per message.**
   Every question must challenge a consequential assumption or surface a
   meaningful alternative; do not ask a template-completion question. Attach a
   proposed answer on its own clearly labelled line:

   `Recommended: <answer>`

   When the question chooses between discrete alternatives, enumerate them as
   short lettered options — `a) …`, `b) …` — and name the chosen letter in the
   recommendation (`Recommended: a) <answer>`), so the user can answer with just
   a letter. The user may reply with a letter, `yes` to ratify the
   recommendation, or an override. After every
   answer, update the working decisions and select the next highest-leverage unresolved gap
   rather than blindly advancing through the headings.
5. **Handle exits and uncertainty.** Normally ask 3–6 questions, with coverage —
   not question count — as the exit condition. Never exceed 7 questions unless
   the user explicitly asks to continue. If the user says `enough`, `stop`, or
   `that's plenty`, end the interview immediately and write with what you have.
   If the user says `I don't know`, use the recommended answer and add this
   visible entry under `## Open Questions`:

   `- Assumed: <decision>; confirm during spec review.`

   Do not hide unresolved assumptions in HTML comments.
6. **Resolve and write.** Record ratifications and overrides in the appropriate
   template sections, then infer `complexity:` only after the rest of the spec is
   resolved. During Deepen, do not invent execution settings, add `agent:`
   frontmatter, mutate other specs, or run `git commit`; those actions are outside
   the interview.
7. **Finish concisely.** In the final response, give a one-sentence rationale for
   the chosen `complexity:` value without adding a rationale section or sentence
   to the spec. If Deepen ran and `aigon config get deepen.enabled` reported
   `true (from default)`, also include exactly this concise hint:

   `Skip next time with --quick; disable everywhere with aigon config set --global deepen.enabled false.`

   Omit the hint when Deepen was skipped or when the setting came from explicit
   project/global configuration. Do not introduce counters or persisted hint
   state.

## Step 3: Write the Spec

### Feature sets (`set:` frontmatter)

**Default: standalone.** Most new specs should **not** have a `set:` tag.

Use `set: <slug>` only when you are creating **two or more inbox specs** that ship together and will be prioritised with `aigon set-prioritise <slug>`.

**Before reusing any set slug**, run `aigon set show <slug>`. If every member is `done`, the set is **closed** — do **not** tag into it. For follow-up work, use `depends_on: [<id>]` and mention prior features under `## Related` instead.

See `.aigon/docs/feature-sets.md` § *Completed sets — do not rejoin*.

### Set the spec frontmatter

**`complexity:` (required)** — drives the per-agent defaults in the dashboard start modal, resolved from each agent's complexity-defaults table and then `aigon config`. **Do not add any other execution-setting frontmatter.**

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

## Step 4: After Writing the Spec

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
