# Feature: metrics-git-attribution

## Summary

Formalize agent commit attribution as the foundation for all AI-native workflow metrics. Ensure every agent commit is reliably identifiable as AI-authored (via Co-authored-by trailers, agent-specific email addresses, or git notes) so downstream metrics can segment AI vs human code for persistence, edit distance, and rework analysis.

## User Stories
- [ ] As a developer using Aigon, I want all agent commits to be reliably tagged so I can distinguish AI-authored code from human code in git history
- [ ] As a metrics consumer, I want a programmatic API to query "which commits/lines are AI-authored" for a given file or feature

## Acceptance Criteria
- [ ] All agent commits (cc, gg, cx, cu) include a machine-parseable attribution marker (Co-authored-by trailer, agent email, or git note)
- [ ] A utility function exists to classify commits as ai-authored, human-authored, or mixed given a commit range
- [ ] Attribution survives squash merges and rebases (git notes or trailer-based approach)
- [ ] Existing worktree/commit flows updated to apply attribution automatically

## Validation
```bash
node --check aigon-cli.js
```

## Technical Approach

Research suggests three complementary approaches (see Git AI, AgentBlame tools):
1. Convention-based: agent worktree branch names, commit author email (`agent@aigon.dev`), Co-authored-by trailers
2. Git notes: attach AI attribution metadata that survives rebases/squashes
3. Git trailers: `Aigon-Agent-ID: <id>` in commit messages

Start with approach 1 (simplest, Aigon already partially does this) and add git notes for squash-merge resilience.

## Dependencies
- None (foundational feature)

## Out of Scope
- IDE-level attribution (keystroke tracking, suggestion acceptance)
- Third-party tool integration (Git AI, AgentBlame) — may adopt later

## Open Questions
- Should mixed-authorship commits (human edits on agent branch) be classified as "mixed" or attributed proportionally?

## Related
- Research: research-19-ai-native-workflow-metrics
- Depends-on: none
- Blocks: metrics-code-durability
