---
complexity: high
# agent: cc    # optional — id of the agent that owns this research spec;
#              #   see feature-template.md for precedence rules.
---

# Research: superpowers

## Context
Superpowers is a plug-in that provides skills and commands for AI development tools including Claude Code, Codex, Gemini CLI, and related agents:

https://github.com/obra/superpowers

It appears to overlap with Aigon's skill and command model, especially around structured AI-assisted software development. This research should study Superpowers as a source of product and prompt-design ideas for Aigon, with particular attention to whether its prompts, skills, workflow decomposition, or operating model can improve Aigon's own agent-facing skill set.

The goal is not to copy Superpowers wholesale. The goal is to identify concrete lessons that could improve Aigon's prompts and skills for core workflows such as creating features, implementing features, running research, reviewing work, and coordinating across AI coding tools.

## Questions to Answer
- [ ] What commands, skills, workflows, and concepts does Superpowers provide, and how do they map to Aigon's existing command and skill surface?
- [ ] Which Superpowers prompts or skill instructions are stronger than Aigon's current equivalents for feature creation, implementation, research, and review?
- [ ] What prompt patterns, framing techniques, task boundaries, or agent instructions from Superpowers would be valuable to adapt into Aigon?
- [ ] Are there capabilities in Superpowers that Aigon lacks entirely, and are any of them worth deeper investigation as future Aigon features?
- [ ] How does Superpowers think about multi-tool or multi-agent AI development differently from Aigon, and what product lessons follow from those differences?
- [ ] Where does Aigon already have stronger or more specific workflow machinery than Superpowers, and where should Aigon avoid changing?
- [ ] What concrete improvements should be proposed for Aigon's templates, skills, command prompts, or workflow documentation?

## Scope

### In Scope
- Review the public Superpowers repository and its agent-facing prompts, commands, skills, and docs.
- Compare Superpowers against Aigon's key skill/prompt areas: feature creation, feature implementation, research, review, and related coordination workflows.
- Identify prompt and skill-design patterns that can be adapted into Aigon.
- Produce specific recommendations that can become follow-up feature specs.
- Note any larger product ideas that deserve separate research or design work.

### Out of Scope
- Implementing changes to Aigon prompts, skills, commands, or templates.
- Building direct compatibility with Superpowers.
- Performing a full architectural audit of either project.
- Evaluating every Superpowers feature exhaustively if it is unrelated to Aigon's agent-facing development workflows.
- Making recommendations that depend on private or unreleased Superpowers material.

## Findings
To be completed during research.

## Recommendation
To be completed during research.

## Output
- [ ] Summary of Superpowers concepts and their nearest Aigon equivalents.
- [ ] Side-by-side assessment of relevant Superpowers and Aigon prompts/skills.
- [ ] Prioritized list of prompt/skill improvements for Aigon.
- [ ] Follow-up feature specs for any recommended Aigon changes.
- [ ] Feature:
