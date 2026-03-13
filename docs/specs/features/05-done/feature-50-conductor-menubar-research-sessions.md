# Feature: conductor-menubar-research-sessions

## Summary

Extend the conductor menubar and `terminal-focus` to display and interact with research tmux sessions alongside features. Also ensure `research-open` sets both the tmux session name and window name using the `aigon-r{ID}-{AGENT}` convention for consistent discovery.

## User Stories

- [ ] As a user running Fleet research, I want to see my research sessions in the macOS menu bar so I can monitor their status and click to focus them
- [ ] As a user, I want `research-open` to set the tmux window name (not just session name) so the menubar plugin can discover and display research sessions consistently

## Acceptance Criteria

- [ ] `menubar-render` scans `docs/specs/research-topics/03-in-progress/` for active research topics
- [ ] `menubar-render` discovers research tmux sessions matching `aigon-r{ID}-{AGENT}` pattern
- [ ] Research sessions appear in the menubar grouped by repo, similar to features
- [ ] Clicking a research session in the menubar focuses that tmux session (via `terminal-focus` or equivalent)
- [ ] `research-open` sets both tmux session name AND window name to `aigon-r{ID}-{AGENT}`
- [ ] `terminal-focus` supports research sessions (pattern `aigon-r{ID}-{AGENT}`) in addition to feature worktrees

## Validation

```bash
node --check aigon-cli.js
```

## Technical Approach

1. **`research-open`**: When creating tmux sessions, pass `-n` flag to set window name matching the session name (`aigon-r{ID}-{AGENT}`)
2. **`menubar-render`**: Add a second scan pass for research topics in `03-in-progress/`, discover agents from findings files in `logs/research-{ID}-{AGENT}-findings.md`, and detect running tmux sessions via `tmux list-sessions`
3. **`terminal-focus`**: Extend pattern matching to support `aigon-r{ID}-{AGENT}` in addition to `feature-{ID}-{AGENT}-*` worktrees

## Dependencies

- Feature 39 (conductor-menubar) — already shipped
- Feature 40 (tmux-terminal-sessions) — already shipped

## Out of Scope

- Research session status detection from findings file front matter (future enhancement)
- Swarm mode session display

## Open Questions

- Should research sessions show agent status (implementing/submitted) based on findings file front matter `status` field?

## Related

- Feedback: `docs/specs/feedback/01-inbox/feedback-1-conductor-menubar-and-research-open-should-show-research-tmux-sessions.md`
- Feature 39: `docs/specs/features/05-done/feature-39-conductor-menubar.md`
- Feature 40: `docs/specs/features/05-done/feature-40-tmux-terminal-sessions.md`
