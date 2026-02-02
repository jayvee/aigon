# aigon-research-synthesize

Synthesize research findings from ALL agents, help the user select features, and update the main research document.

## Argument Resolution

If no ID is provided, or the ID doesn't match an existing topic in progress:
1. List all files in `./docs/specs/research-topics/03-in-progress/` matching `research-*.md`
2. If a partial ID or name was given, filter to matches
3. Present the matching topics and ask the user to choose one

## Recommended: Use a Different Model

For unbiased synthesis, use a **different model** than those that conducted the research.

```bash
claude --model sonnet
/aigon-research-synthesize 05
```

## Step 1: Read All Findings

Find and read ALL findings files:
```
docs/specs/research-topics/logs/research-{ID}-*-findings.md
```

Also read the main research topic:
```
docs/specs/research-topics/03-in-progress/research-{ID}-*.md
```

## Step 2: Synthesize Findings

Present to the user:

### Consensus
What all agents agree on.

### Divergent Views
Where agents disagree and why - be specific about which agent said what.

## Step 3: Consolidate Features

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

## Step 4: Get User Approval

Ask the user:

> "Here are the consolidated features. Which should I include in the final research output?
> - Enter numbers to include (e.g., `1,2,3`)
> - Enter `all` to include everything
> - Enter `consensus` to include only consensus items
> - Enter `none` to skip feature selection"

Wait for user response before proceeding.

## Step 5: Update Main Research Doc

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
<!-- If any features have dependencies, list them here -->
- feature-b depends on feature-a

### Not Selected
<!-- Features discussed but not selected, for reference -->
- other-feature: Reason not selected
```

## Step 6: Complete

After updating the document, run:
```bash
aigon research-done {ID} --complete
```

## Important

- Read ALL findings files, not just your own
- Be objective when presenting - don't favor your own findings
- Wait for user confirmation before updating files
- Use the exact table format so output is clean and actionable


ARGUMENTS: <args>
