# Feature: "Works With" Integration Guide

## Summary
Create a page on aigon-site showing how Aigon integrates with existing
AI coding tools (Claude Code, Cursor, Ampcode). Position Aigon as the
workflow orchestration layer — the missing piece between "I have AI
coding tools" and "I have a development process." No head-to-head
comparisons or superiority claims.

## Content Outline
- What Aigon adds on top of your existing tools (spec lifecycle,
  kanban, multi-agent fleet orchestration)
- Integration points per supported agent:
  - Claude Code: worktrees, slash commands, agent dispatch
  - Cursor: cu agent, Composer, implementation-only role
  - (Ampcode, others as supported)
- Visual workflow: idea → spec → agent dispatch → review → done

## Acceptance Criteria
- [ ] Page explains Aigon's role without claiming superiority over any tool
- [ ] Each supported agent has a section showing how it plugs in
- [ ] Includes a visual workflow diagram
- [ ] Added to aigon-site navigation
- [ ] Content is factually accurate with links to each tool's docs

## Open Questions
- Which agents are officially supported vs experimental?
- Should this live at /integrations, /how-it-works, or somewhere else?
- Revisit direct competitor comparisons once positioning is clearer
