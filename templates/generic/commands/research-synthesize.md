<!-- description: Synthesize research <ID> - compare findings and select features -->
# aigon-research-synthesize

Synthesize research findings from ALL agents in an arena mode research topic, help the user select features, and update the main research document.

## Recommended: Use a Different Model

For unbiased synthesis, use a **different model** than the ones that conducted the research.

```bash
# If research was conducted by Opus, Gemini, Codex - synthesize with Sonnet
claude --model sonnet
/aigon-research-synthesize 05
```

## Your Task

### Step 1: Read All Findings

Find and read ALL findings files for this research ID:
```
docs/specs/research-topics/logs/research-{ID}-*-findings.md
```

Also read the main research topic to understand the original questions:
```
docs/specs/research-topics/03-in-progress/research-{ID}-*.md
```

### Step 2: Synthesize and Present

Present a synthesis to the user:

1. **Consensus findings** - what all agents agree on
2. **Divergent perspectives** - where agents disagree and why
3. **All suggested features** with:
   - Which agents suggested each (duplicates = stronger signal)
   - Brief description
   - Your recommended priority

Example format:
```
## Suggested Features

| # | Feature | Suggested By | Description | Recommended |
|---|---------|--------------|-------------|-------------|
| 1 | feature-a | cc, gg | Both agents suggested this | Yes |
| 2 | feature-b | cc | Unique to Claude | Yes |
| 3 | feature-c | gg | Unique to Gemini | Maybe |
| 4 | feature-d | cx | Unique to Codex | No |
```

### Step 3: Ask User for Selection

Ask the user which features to include. Offer options like:
- "Which features should I include? (e.g., '1,2,3' or 'all' or 'recommended')"
- Let them approve your recommendations or customize

### Step 4: Update the Main Research Doc

Once the user confirms their selection, update the main research document's `## Output` section:

```markdown
## Output

**Selected features from research:**
- feature-a: Description
- feature-b: Description

**Feature specs to create:**
- [ ] Feature: feature-a
- [ ] Feature: feature-b
```

Also update the `## Recommendation` section with your synthesized recommendation.

### Step 5: Complete

After updating the document, tell the user:
```
Research synthesis complete! The main document has been updated.

To finalize and move to done, run:
  aigon research-done {ID} --complete
```

## Important

- Read ALL findings files, not just your own
- Present findings objectively before asking for selection
- Only modify the main research doc after user confirms feature selection
- Do NOT run `aigon research-done` yourself


ARGUMENTS: {{ARG_SYNTAX}}
