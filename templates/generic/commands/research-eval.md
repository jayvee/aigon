<!-- description: Evaluate research <ID> - synthesize findings and recommend features -->
# aigon-research-eval

Evaluate and synthesize research findings from ALL agents, help the user select features, and update the main research document. This transitions research from in-progress to in-evaluation (matching the feature pipeline).

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress or in-evaluation:
1. List all files in `./docs/specs/research-topics/03-in-progress/` and `./docs/specs/research-topics/04-in-evaluation/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Recommended: Use a Different Model

For unbiased evaluation, use a **different model** than those that conducted the research.

```bash
claude --model sonnet
/aigon-research-eval 05
```

## Step 1: Run the CLI command

IMPORTANT: You MUST run this command first. It transitions the engine state to evaluating and moves the spec to the evaluation folder.

```bash
aigon research-eval {{ARG1_SYNTAX}}
```

## Step 2: Read All Findings

Find and read ALL findings files:
```
docs/specs/research-topics/logs/research-{ID}-*-findings.md
```

Also read the main research topic:
```
docs/specs/research-topics/04-in-evaluation/research-{ID}-*.md
```

(If not found in `04-in-evaluation/`, check `03-in-progress/`.)

## Step 3: Synthesize Findings

Present to the user:

### Consensus
What all agents agree on.

### Divergent Views
Where agents disagree and why - be specific about which agent said what.

## Step 4: Consolidate Features

Extract the `## Suggested Features` table from each agent's findings file.

**Deduplication rules:**
1. **Exact match**: Same feature name from multiple agents = one entry, note all agents
2. **Similar concept**: Different names but same idea = merge into one, pick the best name
3. **Related but distinct**: Keep separate but note the relationship
4. **Unique**: One agent only = keep, but flag for user attention

**Present a consolidated table:**

```markdown
## Consolidated Features

| # | Feature Name | Description | Priority | Agents | Status |
|---|--------------|-------------|----------|--------|--------|
| 1 | feature-name | Best description | high | cc, gg | Consensus |
| 2 | another-feat | Description | medium | cc | Unique to Claude |
| 3 | third-feat | Description | low | gg, cx | Consensus |
```

**Status values:**
- `Consensus` - Multiple agents suggested (stronger signal)
- `Unique to [Agent]` - Only one agent suggested
- `Merged` - Combined similar suggestions from multiple agents

## Step 5: Get User Approval and Create Features

Before pausing, signal the dashboard that you are blocked on user input so the card gets a pulsing "Awaiting input" badge and the user gets a desktop notification (they may not be watching the tmux pane):

```bash
aigon agent-status awaiting-input "Pick which of the consolidated features to create. Reply with numbers, 'all', 'consensus', or 'none'."
```

Then ask the user:

> "Here are the consolidated features. Which should I create?
> - Enter numbers to include (e.g., `1,2,3`)
> - Enter `all` to include everything
> - Enter `consensus` to include only consensus items
> - Enter `none` to skip feature creation"

Wait for user response before proceeding. The awaiting-input flag clears automatically on the next `agent-status` write.

### Feature Set Naming

**Default: group as a set.** Features created from the same research topic share context and are almost always related. Unless the user explicitly opts out, stamp every spec with a shared `set:` slug and wire dependencies between them.

#### Step A — Derive the plan (do this before asking anything)

Derive a set slug:
- lowercase the topic slug
- trim the leading `research-<id>-` prefix if present
- keep it short and descriptive (example: `research-34-feature-set` → `feature-set`)

Name features with **common prefix + sequence numbers** in dependency order (feature 1 has no deps, feature 2 depends on 1, etc.):

```
<prefix>-1-<specific-name>
<prefix>-2-<specific-name>
<prefix>-3-<specific-name>
```

Analyse the dependency chain across the selected features. For each feature, decide: does it depend on another selected feature? A feature depends on another when it cannot be safely started until that one is merged (shared data model, API contract, etc.). Be concrete — "feature 2 needs the xterm.js bundle from feature 1" — not vague.

#### Step B — Present the full plan and wait (REQUIRED CHECKPOINT)

**Do not run any `feature-create` command until the user responds to this prompt.**

Present the complete plan in one message:

> "I’ll group these as set `<slug>`. Here’s the naming and dependency plan:
>
> | # | Name | Depends on |
> |---|------|------------|
> | 1 | `<prefix>-1-<name>` | — |
> | 2 | `<prefix>-2-<name>` | #1 |
> | 3 | `<prefix>-3-<name>` | #2 |
>
> Dependencies are based on: [brief reason — e.g., "feature 2 needs the WS layer from feature 1"].
>
> - Enter or `y` = confirm (creates with `--set <slug>` and wires `depends_on`)
> - `n` = create without set grouping or dependencies
> - `edit slug` = adjust the slug before confirming
> - Adjust numbering/deps inline if the order is wrong"

#### Step C — Create features

**If confirmed (default):**

```bash
aigon feature-create "prefix-1-name" --set <slug>
aigon feature-create "prefix-2-name" --set <slug>
```

**If declined:**

```bash
aigon feature-create "feature-name"
```

After creating each feature, edit the spec to add:

1. Research origin backlink:
```markdown
## Related
- Research: #{ID} {research-name}
```

2. For features that depend on another feature in this set, add `depends_on` to the **Dependencies** section:
```markdown
## Dependencies
- depends_on: prefix-1-name
```
This enables Aigon’s dependency system to enforce ordering — dependent features cannot be started until their dependencies are done. Every feature that has a predecessor **must** have this field; omitting it is a mistake.

## Step 6: Update Main Research Doc

Once user confirms, update the main research document:

**Update `## Recommendation`** with your synthesized recommendation.

**Update `## Output`** with the selected features:

```markdown
## Output

### Set Decision

- Proposed Set Slug: `feature-set`
- Chosen Set Slug: `feature-set`
<!-- If declined, write: Chosen Set Slug: none (declined) -->

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| feature-name | Description | high | `aigon feature-create "feature-name" --set feature-set` |

### Feature Dependencies
<!-- List dependency chains so features can be prioritised in order -->
<!-- Each feature spec should have depends_on in its Dependencies section -->
- feature-b depends on feature-a (feature-b spec has `depends_on: feature-a`)

### Not Selected
<!-- Features discussed but not selected, for reference -->
- other-feature: Reason not selected
```

If the user declined grouping, keep the `Create Command` column without `--set` and record `Chosen Set Slug: none (declined)` so a later re-evaluation can preserve that decision explicitly.

## Step 7: Commit and hand off

**THIS IS THE FINAL STEP. YOU MUST COMPLETE IT. DO NOT SKIP THIS STEP.**

After updating the document, commit your changes:

```bash
git add docs/specs/research-topics/ docs/specs/features/01-inbox/
git commit -m "docs: research evaluation for {{ARG1_SYNTAX}}"
```

Then tell the user:

> "Evaluation complete. Selected features have been created with research backlinks. Run `/aigon:research-close {ID}` when ready."

Do **not** run `aigon agent-status submitted` — that signal is for the per-agent findings phase (`03-in-progress`). Closing out the evaluation is a user decision; they run `research-close` when they're satisfied with the output.

**STAY in the session.** The user may want to review the evaluation or ask for changes.

## Important

- Read ALL findings files, not just your own
- Be objective when presenting - don't favor your own findings
- Wait for user confirmation before updating files or creating features
- Use the exact table format so output is clean and actionable
- Created features must include a research origin backlink


ARGUMENTS: {{ARG_SYNTAX}}
