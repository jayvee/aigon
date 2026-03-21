# Feature: showcase-v233-features

## Summary
Update the Aigon marketing site to showcase features from v2.33.0: tmux persistent sessions, iTerm2 native integration, eval agent completion checks, and the "Needs Attention" board section.

## User Stories
- [ ] As a visitor, I want to see that Aigon supports persistent tmux sessions so I understand the "bring it back" UX
- [ ] As a visitor, I want to see iTerm2's native tmux -CC integration so I know Aigon works with modern terminal workflows
- [ ] As a visitor, I want to see the eval completion check so I understand Aigon's safety guardrails

## Acceptance Criteria
- [ ] Add a "Persistent Sessions" section showing tmux terminal support
- [ ] Include screenshot/demo of iTerm2 with tmux -CC (native tabs)
- [ ] Show the eval agent completion check warning output
- [ ] Update the "Needs Attention" board showcase (from recent menubar redesign)
- [ ] Add tmux/iTerm2 to the terminal options comparison if one exists
- [ ] Ensure mobile-responsive layout for new sections

## Screenshots Needed
- [ ] `tmux-iterm2-native.png` — iTerm2 window with tmux -CC showing agent session and control mode panel
- [ ] `eval-completion-check.png` — Terminal output showing the "agents not yet submitted" warning
- [ ] `needs-attention-board.png` — Aigon board with the Needs Attention section visible
- [ ] `menubar-needs-attention.png` — macOS menubar showing needs attention items

## Technical Approach
- Add new sections to the site's feature showcase area
- Use screenshot placeholders with `<!-- SCREENSHOT: filename.png -->` markers until real screenshots are captured
- Follow existing site design patterns and component structure

## Dependencies
- Screenshots from actual Aigon v2.33.0 usage
- Existing aigon-site component library

## Out of Scope
- Redesigning existing site sections
- Video demos (future enhancement)
- Interactive terminal demos

## Related
- Aigon v2.33.0 release (tmux sessions, iTerm2, eval check)
- Feature: menubar-showcase (already in inbox)
