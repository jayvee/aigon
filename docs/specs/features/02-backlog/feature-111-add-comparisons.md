# Feature: add-comparisons

## Summary

Expand COMPARISONS.md with comprehensive comparisons against 12 commercial and open-source tools. Replace the current Cursor-only comparison with a feature matrix covering all tools, followed by individual deep-dives. The comparisons must be honest — Aigon should clearly lag behind on some dimensions (UI polish, embedded browser, IDE integration) while showing standout features others don't have (vendor independence, spec lifecycle, Fleet multi-agent, feedback loop, research workflows).

## Tools to Compare

### Commercial
- Cursor IDE (existing, update)
- GitHub Copilot Workspace + Spec Kit — https://githubnext.com/projects/copilot-workspace
- AWS Kiro — https://kiro.dev/
- AmpCode — https://ampcode.com/
- Augment Code — https://www.augmentcode.com/
- Tessl — https://tessl.io/

### Open Source
- Cline — https://cline.bot/
- LangGraph — https://www.langchain.com/langgraph
- GSD (Get Shit Done) — https://github.com/gsd-build/get-shit-done
- BMad — https://docs.bmad-method.org/
- OpenSpec — https://github.com/Fission-AI/OpenSpec/
- Aider — https://aider.chat/docs/
- OpenCode — https://opencode.ai/docs

## Acceptance Criteria

- [ ] COMPARISONS.md has a master feature matrix table comparing all 13 tools (including Aigon) across at least 10 dimensions
- [ ] Matrix uses clear symbols: full support, partial, none — not just checkmarks
- [ ] Aigon is honestly behind on at least 3 dimensions (e.g. IDE integration, visual UI, embedded browser testing, community size)
- [ ] Aigon has at least 4 standout features that no other tool has (e.g. vendor-independent multi-agent Fleet, spec lifecycle with Kanban, research workflows, feedback triage loop)
- [ ] Each tool has a brief profile section (2-4 sentences: what it is, philosophy, pricing model)
- [ ] "When to choose" guidance for each tool vs Aigon
- [ ] Remove the "Coming Soon" placeholder section
- [ ] Remove the "Strategic Gaps" section — that's internal planning, not user-facing
- [ ] Keep the "Complementary Usage" concept (Aigon + other tools together)
- [ ] Date updated to current

## Validation

```bash
# Check file exists and has content
test -f COMPARISONS.md && [ $(wc -l < COMPARISONS.md) -gt 200 ]
```

## Technical Approach

### Matrix Dimensions (minimum)

| Dimension | Description |
|-----------|-------------|
| Multi-agent | Can run multiple AI agents in parallel |
| Vendor independence | Works across multiple LLM providers |
| Spec lifecycle | Formal spec creation → implementation → evaluation pipeline |
| Research workflows | Structured investigation before building |
| Feedback loop | Capture user input → triage → promote to features |
| IDE integration | Native IDE experience (VS Code, JetBrains, etc.) |
| Visual UI | Browser dashboard, visual diffs, embedded preview |
| Autonomous mode | Agent loops until tests pass without human intervention |
| Context persistence | Where project context/history lives (Git vs cloud vs ephemeral) |
| Cost model | Free, subscription, API-based, etc. |

### Honesty Guidelines

Aigon is clearly behind on:
- **IDE integration** — CLI-first, no native IDE experience
- **Visual UI** — dashboard exists but no embedded browser testing, no visual diff
- **Community size** — small compared to Cursor, Copilot, Cline, Aider
- **Setup friction** — more steps than one-click IDE tools

Aigon stands out on:
- **Vendor independence** — only tool that orchestrates Claude, Gemini, Codex, and Cursor together
- **Spec lifecycle** — full Kanban pipeline from inbox to done with acceptance criteria
- **Research workflows** — parallel research with synthesis, no other tool has this
- **Feedback triage loop** — closes the product loop from users back to features
- **Fleet multi-agent** — unlimited competing agents with structured evaluation

### Structure

1. Master feature matrix (all tools, all dimensions)
2. Commercial tools section (brief profiles + when to choose)
3. Open source tools section (brief profiles + when to choose)
4. Complementary usage (how to use Aigon alongside other tools)

## Dependencies

- Web research on each tool's current features and pricing (agent should visit the URLs provided)

## Out of Scope

- Detailed multi-page analysis per tool (keep it concise)
- Performance benchmarks
- Code examples for each tool
- Internal strategic planning (remove from COMPARISONS.md)

## Related

- Current COMPARISONS.md (Cursor-only comparison)
- README.md references COMPARISONS.md in the final section
