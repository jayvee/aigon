<!-- description: Synthesize research <ID> - compare all agents' findings -->
# aigon-research-synthesize

Help the user synthesize research findings from ALL agents in an arena mode research topic.

**IMPORTANT:** This is a synthesis task. You are NOT conducting new research. Your job is to read, compare, and help the user understand the findings from ALL agents.

## Recommended: Use a Different Model

For unbiased synthesis, use a **different model** than the ones that conducted the research. This avoids the synthesizer favoring its own findings.

```bash
# If research was conducted by Opus, Gemini, Codex - synthesize with Sonnet
claude --model sonnet
/aigon-research-synthesize 05
```

## Your Task

1. **Find all findings files** for this research ID:
   ```
   docs/specs/research-topics/logs/research-{ID}-*-findings.md
   ```
   Read ALL of them, not just your own.

2. **Read the main research topic** to understand the original questions:
   ```
   docs/specs/research-topics/03-in-progress/research-{ID}-*.md
   ```

3. **Compare and contrast** the findings from each agent:
   - What do agents agree on?
   - Where do they differ?
   - What unique insights does each agent provide?
   - Which recommendations are most supported by evidence?

4. **Analyze suggested features** from all agents:
   - List all suggested features across all agents
   - Identify duplicates (same feature, different descriptions)
   - Note which features multiple agents suggested (stronger signal)
   - Highlight unique suggestions from individual agents

5. **Provide a synthesis summary** for the user:
   - Key findings that all agents agree on
   - Areas of disagreement and why
   - Recommended features (combining the best from all agents)
   - Your recommendation on which approach to take

6. **DO NOT modify any files** - this is a read-only analysis task. The user will run `aigon research-done {ID}` to interactively select features and complete the research.

## Output Format

Provide your synthesis in this format:

```
## Research Synthesis: {Topic Name}

### Consensus Findings
- [Findings all agents agree on]

### Divergent Perspectives
- [Where agents disagree and why]

### Feature Recommendations
| Feature | Suggested By | Priority | Notes |
|---------|--------------|----------|-------|
| feature-name | cc, gg | High | Both agents suggested this |
| other-feature | cx | Medium | Unique to Codex |

### My Recommendation
[Your synthesized recommendation based on all findings]
```

After you provide the synthesis, remind the user to run:
```bash
aigon research-done {ID}
```
to interactively select features and complete the research.


ARGUMENTS: {{ARG_SYNTAX}}
