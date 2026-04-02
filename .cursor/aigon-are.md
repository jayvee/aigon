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
aigon research-eval <name>
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

Ask the user:

> "Here are the consolidated features. Which should I create?
> - Enter numbers to include (e.g., `1,2,3`)
> - Enter `all` to include everything
> - Enter `consensus` to include only consensus items
> - Enter `none` to skip feature creation"

Wait for user response before proceeding.

**For each selected feature, run:**

```bash
aigon feature-create "feature-name"
```

After creating each feature:

1. Add a research origin backlink to the new feature spec:
```markdown
## Related
- Research: #{ID} {research-name}
```

2. If this feature depends on another feature from this research, add `depends_on` to the **Dependencies** section:
```markdown
## Dependencies
- depends_on: feature-name-it-depends-on
```
This enables Aigon's dependency system to enforce ordering — dependent features cannot be started until their dependencies are done.

## Step 6: Update Main Research Doc

Once user confirms, update the main research document:

**Update `## Recommendation`** with your synthesized recommendation.

**Update `## Output`** with the selected features:

```markdown
## Output

### Selected Features

| Feature Name | Description | Priority | Create Command |
|--------------|-------------|----------|----------------|
| feature-name | Description | high | `aigon feature-create "feature-name"` |

### Feature Dependencies
<!-- List dependency chains so features can be prioritised in order -->
<!-- Each feature spec should have depends_on in its Dependencies section -->
- feature-b depends on feature-a (feature-b spec has `depends_on: feature-a`)

### Not Selected
<!-- Features discussed but not selected, for reference -->
- other-feature: Reason not selected
```

## Step 7: Signal completion

**THIS IS THE FINAL STEP. YOU MUST COMPLETE IT. DO NOT SKIP THIS STEP.**

After updating the document, commit your changes and signal completion:

```bash
git add docs/specs/research-topics/
git commit -m "docs: research evaluation for <name>"
aigon research-submit <name>
```

Then tell the user:

> "Evaluation complete. Selected features have been created with research backlinks. Run `/aigon:research-close {ID}` when ready."

**STAY in the session.** The user may want to review the evaluation or ask for changes.

## Important

- Read ALL findings files, not just your own
- Be objective when presenting - don't favor your own findings
- Wait for user confirmation before updating files or creating features
- Use the exact table format so output is clean and actionable
- Created features must include a research origin backlink


ARGUMENTS: <args>
